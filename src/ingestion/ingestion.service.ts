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
   * Update file upload status
   */
  async updateStatus(
    contentHash: string,
    status: 'completed' | 'failed',
    chunkCount?: number,
    errorMessage?: string,
  ): Promise<void> {
    await this.fileUploadRepository.update(
      { content_hash: contentHash },
      {
        status,
        chunk_count: chunkCount,
        error_message: errorMessage,
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
}
