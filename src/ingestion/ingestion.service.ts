import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileUpload } from './entities/file-upload.entity';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
  ) {}

  /**
   * Find a file upload by content hash
   */
  async findByHash(contentHash: string): Promise<FileUpload | null> {
    return this.fileUploadRepository.findOne({
      where: { content_hash: contentHash },
    });
  }

  /**
   * Find a file upload by job ID
   */
  async findByJobId(jobId: string): Promise<FileUpload | null> {
    return this.fileUploadRepository.findOne({
      where: { job_id: jobId },
    });
  }

  /**
   * Create a new file upload record
   */
  async create(data: Partial<FileUpload>): Promise<FileUpload> {
    const fileUpload = this.fileUploadRepository.create(data);
    return this.fileUploadRepository.save(fileUpload);
  }

  /**
   * Upsert processing metadata by content hash (idempotent)
   */
  async upsertProcessingRecord(data: {
    contentHash: string;
    originalFilename: string;
    uploadedBy: string;
    jobId: string;
    r2ObjectKey: string;
  }): Promise<FileUpload> {
    const existing = await this.findByHash(data.contentHash);

    if (existing) {
      await this.fileUploadRepository.update(
        { content_hash: data.contentHash },
        {
          original_filename: data.originalFilename,
          uploaded_by: data.uploadedBy,
          job_id: data.jobId,
          r2_object_key: data.r2ObjectKey,
          status: 'processing',
          chunk_count: null,
          error_message: null,
        },
      );

      const updated = await this.findByHash(data.contentHash);
      if (updated) {
        return updated;
      }
    }

    return this.create({
      content_hash: data.contentHash,
      original_filename: data.originalFilename,
      uploaded_by: data.uploadedBy,
      job_id: data.jobId,
      r2_object_key: data.r2ObjectKey,
      status: 'processing',
      chunk_count: null,
      error_message: null,
    });
  }

  /**
   * Update file upload status
   */
  async updateStatus(
    contentHash: string,
    status: 'completed' | 'failed',
    chunkCount?: number,
    errorMessage?: string,
  ): Promise<void> {
    const resolvedErrorMessage =
      status === 'completed' ? null : (errorMessage ?? null);

    await this.fileUploadRepository.update(
      { content_hash: contentHash },
      {
        status,
        chunk_count: chunkCount,
        error_message: resolvedErrorMessage,
      },
    );
  }

  /**
   * Get all file uploads (for admin/debugging)
   */
  async findAll(limit = 100): Promise<FileUpload[]> {
    return this.fileUploadRepository.find({
      order: { uploaded_at: 'DESC' },
      take: limit,
    });
  }

  /**
   * Delete upload metadata by job ID
   */
  async deleteByJobId(jobId: string): Promise<number> {
    const result = await this.fileUploadRepository.delete({ job_id: jobId });
    return result.affected ?? 0;
  }
}
