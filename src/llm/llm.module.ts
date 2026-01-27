import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LlmService } from './llm.service';
import { LlmController } from './llm.controller';

@Module({
  imports: [HttpModule],
  providers: [LlmService],
  controllers: [LlmController],
})
export class LlmModule {}
