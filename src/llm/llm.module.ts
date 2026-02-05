import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LlmService } from './llm.service';
import { LlmController } from './llm.controller';
import { RagService } from './rag.service';
import { LlmV2Controller } from './llm.v2.controller';
import { LlmV2Service } from './llm.v2.service';
import { LoggerService } from '../logs/logger.service';

@Module({
  imports: [HttpModule],
  providers: [LlmService, LlmV2Service, RagService, LoggerService],
  controllers: [LlmController, LlmV2Controller],
})
export class LlmModule {}
