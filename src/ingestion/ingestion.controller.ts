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
import { Queue } from 'bullmq';
import { ApiBearerAuth } from '@nestjs/swagger';
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

@Controller('ingestion')
export class IngestionController {
  private readonly logger = new Logger(IngestionController.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly ingestionService: IngestionService,
    @InjectQueue('pdf-ingestion') private pdfQueue: Queue,
  ) {}

  @Post('upload-url')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('JWT-auth')
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
  async getStatus(@Param('jobId') jobId: string) {
    const job = await this.pdfQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const fileUpload = await this.ingestionService.findByJobId(jobId);

    return {
      id: job.id,
      status: await job.getState(),
      progress: job.progress,
      result: job.returnvalue as Record<string, unknown>,
      failedReason: job.failedReason,
      metadata: fileUpload,
    };
  }

  @Get('file/:hash')
  async getFileMetadata(@Param('hash') hash: string) {
    const metadata = await this.ingestionService.findByHash(hash);
    if (!metadata) {
      throw new NotFoundException('File not found');
    }
    return metadata;
  }

  @Get('files')
  async getAllFiles() {
    return this.ingestionService.findAll();
  }

  @Post('retry/:jobId')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth('JWT-auth')
  async retryJob(@Param('jobId') jobId: string) {
    const job = await this.pdfQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const state = await job.getState();
    if (state !== 'failed' && state !== 'completed') {
      return {
        status: 'error',
        message: `Cannot retry job in state: ${state}`,
      };
    }

    // Get original job data
    const jobData = job.data as PdfJobData;
    const { objectKey, fileName, fileHash, userId } = jobData;

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

    // Update database with new job ID
    await this.ingestionService.create({
      content_hash: fileHash,
      original_filename: fileName,
      uploaded_by: userId,
      job_id: newJob.id as string,
      r2_object_key: objectKey,
      status: 'processing',
    });

    return {
      status: 'queued',
      newJobId: newJob.id,
      originalJobId: jobId,
    };
  }
}
