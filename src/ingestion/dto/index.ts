import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetUploadUrlDto {
  @ApiProperty({
    example: 'Apache Flink.pdf',
    description: 'Original file name to upload',
  })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({
    example:
      'a2f68b37d4f3f30659483474752c97a01817aabe7376ed589b552d07c8cd3b82',
    description: 'SHA-256 hash of the file content for deduplication',
  })
  @IsString()
  @IsNotEmpty()
  fileHash: string;

  @ApiPropertyOptional({
    example: '860cbf90-a1c5-48af-a8fe-697b24174ab3',
    description: 'Authenticated user ID',
  })
  @IsString()
  @IsOptional()
  userId?: string;
}

export class TriggerProcessingDto {
  @ApiProperty({
    example:
      'pdfs/a2f68b37d4f3f30659483474752c97a01817aabe7376ed589b552d07c8cd3b82-1773260274090-Apache Flink.pdf',
    description: 'R2 object key for uploaded file',
  })
  @IsString()
  @IsNotEmpty()
  objectKey: string;

  @ApiProperty({
    example: 'Apache Flink.pdf',
    description: 'Original file name',
  })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({
    example:
      'a2f68b37d4f3f30659483474752c97a01817aabe7376ed589b552d07c8cd3b82',
    description: 'SHA-256 hash of the file content',
  })
  @IsString()
  @IsNotEmpty()
  fileHash: string;

  @ApiPropertyOptional({
    example: '860cbf90-a1c5-48af-a8fe-697b24174ab3',
    description: 'Authenticated user ID',
  })
  @IsString()
  @IsOptional()
  userId?: string;
}

export class JobStatusDto {
  id: string;
  status: string;
  progress: number;
  result?: any;
  failedReason?: string;
  metadata?: any;
}
