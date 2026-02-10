import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { AgentModule } from './agent/agent.module';
import { LoggerService } from './logs/logger.service';

@Module({
  imports: [LlmModule, AgentModule],
  controllers: [AppController],
  providers: [AppService, LoggerService],
  exports: [LoggerService],
})
export class AppModule {}
