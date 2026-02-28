import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class GetUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  fileHash: string;

  @IsString()
  @IsOptional()
  userId?: string;
}

export class TriggerProcessingDto {
  @IsString()
  @IsNotEmpty()
  objectKey: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  fileHash: string;

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
