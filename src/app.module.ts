import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { LoggerModule } from './logs/logger.module';

@Module({
  imports: [LoggerModule, LlmModule, AgentModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
