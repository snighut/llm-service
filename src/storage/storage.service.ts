import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? '';
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? '';
    this.bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME ?? '';

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.logger.log('Storage service initialized with Cloudflare R2');
  }

  /**
   * Generate a pre-signed URL for uploading a file
   */
  async getUploadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: 'application/pdf',
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Download a file from R2
   */
  async downloadFile(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      const stream = response.Body as Readable;

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Failed to download file: ${key}`, error);
      throw new Error(`Storage download failed: ${(error as Error).message}`);
    }
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      this.logger.log(`Deleted file: ${key}`);
    } catch (error) {
      this.logger.warn(`Failed to delete file: ${key}`, error);
      // Don't throw - deletion is cleanup, not critical
    }
  }
}
