import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  NotFoundException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import { IngestionService } from './ingestion.service';
import { StorageService } from '../storage/storage.service';
import { GetUploadUrlDto, TriggerProcessingDto } from './dto';

interface PdfJobData {
  objectKey: string;
  fileHash: string;
  fileName: string;
  userId: string;
}

@ApiTags('ingestion')
@Controller('ingestion')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);
  private readonly staleActiveThresholdMs = Number(
    process.env.INGESTION_STALE_ACTIVE_MS || 60000,
  );

  constructor(
    private readonly storageService: StorageService,
    private readonly ingestionService: IngestionService,
    @InjectQueue('pdf-ingestion') private pdfQueue: Queue,
  ) {}

  @Post('upload-url')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Generate signed upload URL for PDF ingestion' })
  @ApiBody({ type: GetUploadUrlDto })
  @ApiResponse({
    status: 201,
    description:
      'Returns either duplicate/processing info or a signed upload URL with object key',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUploadUrl(@Body() dto: GetUploadUrlDto) {
    const { fileName, fileHash } = dto;

    this.logger.log(
      `Upload URL requested for: ${fileName} (hash: ${fileHash})`,
    );

    // Check for duplicates
    const existingFile = await this.ingestionService.findByHash(fileHash);

    if (existingFile) {
      if (existingFile.status === 'completed') {
        this.logger.log(`Duplicate file detected: ${fileHash}`);
        return {
          status: 'duplicate',
          message: `File already processed as "${existingFile.original_filename}"`,
          skipUpload: true,
          metadata: existingFile,
        };
      } else if (existingFile.status === 'processing') {
        this.logger.log(`File already processing: ${fileHash}`);
        return {
          status: 'processing',
          message: 'File is currently being processed',
          jobId: existingFile.job_id,
          skipUpload: true,
        };
      }
    }

    // Generate R2 object key
    const objectKey = `pdfs/${fileHash}-${Date.now()}-${fileName}`;

    // Generate pre-signed URL
    const uploadUrl = await this.storageService.getUploadUrl(objectKey);

    this.logger.log(`Generated upload URL for: ${objectKey}`);

    return {
      uploadUrl,
      objectKey,
      fileHash,
      expiresIn: 3600,
    };
  }

  @Post('process')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Enqueue processing job for uploaded PDF' })
  @ApiBody({ type: TriggerProcessingDto })
  @ApiResponse({
    status: 201,
    description: 'Job queued or already processing for the same content hash',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async triggerProcessing(@Body() dto: TriggerProcessingDto) {
    const { objectKey, fileName, fileHash, userId } = dto;

    this.logger.log(
      `Processing requested for: ${fileName} (key: ${objectKey})`,
    );

    // Verify not already processing
    const existingFile = await this.ingestionService.findByHash(fileHash);
    if (existingFile?.status === 'processing') {
      this.logger.warn(`File already processing: ${fileHash}`);
      return {
        status: 'already_processing',
        jobId: existingFile.job_id,
      };
    }

    // Enqueue job
    const job = await this.pdfQueue.add('process-pdf', {
      objectKey,
      fileName,
      fileHash,
      userId,
    });

    this.logger.log(`Job enqueued: ${job.id} for file: ${fileName}`);

    // Save metadata to database
    await this.ingestionService.create({
      content_hash: fileHash,
      original_filename: fileName,
      uploaded_by: userId,
      job_id: job.id as string,
      r2_object_key: objectKey,
      status: 'processing',
    });

    return {
      status: 'queued',
      jobId: job.id,
    };
  }

  @Get('status/:jobId')
  @ApiOperation({
    summary: 'Get normalized and raw status for a processing job',
  })
  @ApiParam({ name: 'jobId', description: 'BullMQ job ID', example: '13' })
  @ApiResponse({
    status: 200,
    description:
      'Returns normalized status, metadata status, queue status, progress, and metadata details',
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getStatus(@Param('jobId') jobId: string) {
    const job = await this.pdfQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const fileUpload = await this.ingestionService.findByJobId(jobId);
    const statusView = await this.resolveStatusView(job, fileUpload?.status);

    return {
      id: job.id,
      status: statusView.effectiveStatus,
      metadataStatus: fileUpload?.status ?? null,
      queueStatus: statusView.queueStatus,
      progress: statusView.progress,
      result: job.returnvalue as Record<string, unknown>,
      failedReason:
        statusView.effectiveStatus === 'failed'
          ? (fileUpload?.error_message ?? job.failedReason)
          : undefined,
      staleActive: statusView.staleActive,
      lockTtlMs: statusView.lockTtlMs,
      metadata: fileUpload,
    };
  }

  @Get('file/:hash')
  @ApiOperation({ summary: 'Get metadata for a file by content hash' })
  @ApiParam({
    name: 'hash',
    description: 'SHA-256 content hash',
    example: 'a2f68b37d4f3f30659483474752c97a01817aabe7376ed589b552d07c8cd3b82',
  })
  @ApiResponse({ status: 200, description: 'File metadata' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getFileMetadata(@Param('hash') hash: string) {
    const metadata = await this.ingestionService.findByHash(hash);
    if (!metadata) {
      throw new NotFoundException('File not found');
    }
    return metadata;
  }

  @Get('files')
  @ApiOperation({
    summary: 'List file uploads with normalized queue/metadata status fields',
  })
  @ApiResponse({ status: 200, description: 'List of ingested/uploaded files' })
  async getAllFiles() {
    const files = await this.ingestionService.findAll();

    return Promise.all(
      files.map(async (file) => {
        const job = await this.pdfQueue.getJob(file.job_id);
        const statusView = await this.resolveStatusView(job, file.status);

        return {
          ...file,
          status: statusView.effectiveStatus,
          metadataStatus: file.status,
          queueStatus: statusView.queueStatus,
          progress: statusView.progress,
          staleActive: statusView.staleActive,
          lockTtlMs: statusView.lockTtlMs,
        };
      }),
    );
  }

  @Post('retry/:jobId')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Retry job idempotently with stale-active recovery and queue-state checks',
  })
  @ApiParam({ name: 'jobId', description: 'BullMQ job ID', example: '13' })
  @ApiResponse({
    status: 201,
    description:
      'Returns queued/requeued/already_queued/already_processing depending on queue state',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async retryJob(@Param('jobId') jobId: string) {
    const job = await this.pdfQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const state = await job.getState();

    // Get original job data
    const jobData = job.data as PdfJobData;
    const { objectKey, fileName, fileHash, userId } = jobData;

    if (state === 'active') {
      const lockInfo = await this.getJobLockInfo(jobId);
      const activeAgeMs = job.processedOn
        ? Date.now() - job.processedOn
        : undefined;

      if (lockInfo.hasLock) {
        return {
          status: 'already_processing',
          message: 'Job is actively being processed',
          jobId,
          lockTtlMs: lockInfo.lockTtlMs,
          activeAgeMs,
        };
      }

      if (
        activeAgeMs !== undefined &&
        activeAgeMs < this.staleActiveThresholdMs
      ) {
        return {
          status: 'error',
          message:
            'Job appears active without lock but is below stale threshold. Retry shortly.',
          jobId,
          activeAgeMs,
          staleThresholdMs: this.staleActiveThresholdMs,
        };
      }

      await this.moveActiveJobToWaiting(jobId);
      this.logger.warn(
        `Recovered stale active job ${jobId} (activeAgeMs=${activeAgeMs ?? -1})`,
      );

      await this.ingestionService.upsertProcessingRecord({
        contentHash: fileHash,
        originalFilename: fileName,
        uploadedBy: userId,
        jobId,
        r2ObjectKey: objectKey,
      });

      return {
        status: 'requeued',
        message: 'Stale active job recovered and moved to waiting',
        jobId,
        activeAgeMs,
      };
    }

    if (state === 'waiting' || state === 'delayed') {
      await this.ingestionService.upsertProcessingRecord({
        contentHash: fileHash,
        originalFilename: fileName,
        uploadedBy: userId,
        jobId,
        r2ObjectKey: objectKey,
      });

      return {
        status: 'already_queued',
        message: `Job is already queued (${state})`,
        jobId,
      };
    }

    if (state !== 'failed' && state !== 'completed') {
      return {
        status: 'error',
        message: `Cannot retry job in state: ${state}`,
      };
    }

    // Create new job with same data
    const newJob = await this.pdfQueue.add('process-pdf', {
      objectKey,
      fileName,
      fileHash,
      userId,
    });

    this.logger.log(
      `Retry job created: ${newJob.id} for original job: ${jobId}`,
    );

    // Idempotently update metadata with new job ID
    await this.ingestionService.upsertProcessingRecord({
      contentHash: fileHash,
      originalFilename: fileName,
      uploadedBy: userId,
      jobId: newJob.id as string,
      r2ObjectKey: objectKey,
    });

    return {
      status: 'queued',
      newJobId: newJob.id,
      originalJobId: jobId,
    };
  }

  private async getJobLockInfo(jobId: string): Promise<{
    hasLock: boolean;
    lockTtlMs: number;
  }> {
    const client = await this.pdfQueue.client;
    const lockKey = this.pdfQueue.toKey(`${jobId}:lock`);
    const lockTtlMs = await client.pttl(lockKey);

    return {
      hasLock: lockTtlMs > 0,
      lockTtlMs,
    };
  }

  private async moveActiveJobToWaiting(jobId: string): Promise<void> {
    const client = await this.pdfQueue.client;
    const activeKey = this.pdfQueue.toKey('active');
    const waitKey = this.pdfQueue.toKey('wait');

    await client.multi().lrem(activeKey, 0, jobId).lpush(waitKey, jobId).exec();
  }

  private async resolveStatusView(
    job: Job | null | undefined,
    metadataStatus?: 'processing' | 'completed' | 'failed',
  ): Promise<{
    effectiveStatus: string;
    queueStatus: string | null;
    progress: number;
    staleActive: boolean;
    lockTtlMs?: number;
  }> {
    if (!job) {
      return {
        effectiveStatus: metadataStatus ?? 'missing',
        queueStatus: null,
        progress: metadataStatus === 'completed' ? 100 : 0,
        staleActive: false,
      };
    }

    const queueStatus = await job.getState();
    let staleActive = false;
    let lockTtlMs: number | undefined;

    if (queueStatus === 'active') {
      const lockInfo = await this.getJobLockInfo(job.id as string);
      staleActive = !lockInfo.hasLock;
      lockTtlMs = lockInfo.lockTtlMs;
    }

    const effectiveStatus =
      metadataStatus === 'failed' || metadataStatus === 'completed'
        ? metadataStatus
        : staleActive
          ? 'stale_active'
          : queueStatus;

    const progress =
      effectiveStatus === 'completed'
        ? 100
        : effectiveStatus === 'failed' || effectiveStatus === 'stale_active'
          ? 0
          : typeof job.progress === 'number'
            ? job.progress
            : 0;

    return {
      effectiveStatus,
      queueStatus,
      progress,
      staleActive,
      lockTtlMs,
    };
  }
}
