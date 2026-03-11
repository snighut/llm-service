import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { IngestionProcessor } from './ingestion.processor';
import { FileUpload } from './entities/file-upload.entity';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';

const ingestionProviders =
  process.env.WORKER_ONLY === 'true'
    ? [IngestionService, IngestionProcessor]
    : [IngestionService];

@Module({
  imports: [TypeOrmModule.forFeature([FileUpload]), StorageModule, QueueModule],
  controllers: [IngestionController],
  providers: ingestionProviders,
  exports: [IngestionService],
})
export class IngestionModule {}
