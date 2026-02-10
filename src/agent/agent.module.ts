import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { DesignToolsService } from './tools/design-tools.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 60000, // 60 second timeout for design-service calls
      maxRedirects: 5,
    }),
  ],
  controllers: [AgentController],
  providers: [AgentService, DesignToolsService],
  exports: [AgentService],
})
export class AgentModule {}
