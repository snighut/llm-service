import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { DesignToolsService } from './tools/design-tools.service';
import { AgentTraceService } from './agent-trace.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    LlmModule,
    HttpModule.register({
      timeout: 60000, // 60 second timeout for design-service calls
      maxRedirects: 5,
    }),
  ],
  controllers: [AgentController],
  providers: [AgentService, DesignToolsService, AgentTraceService],
  exports: [AgentService],
})
export class AgentModule {}
