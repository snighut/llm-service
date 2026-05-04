import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AgentDebugRunResultDto {
  @ApiPropertyOptional({ description: 'Created design id for this run' })
  designId?: string;

  @ApiPropertyOptional({ description: 'Final validation score for this run' })
  validationScore?: number;

  @ApiPropertyOptional({ description: 'Total attempts performed' })
  attempts?: number;
}

export class AgentDebugRunSummaryDto {
  @ApiProperty({ description: 'Trace run identifier' })
  runId!: string;

  @ApiPropertyOptional({ description: 'Authenticated user id for this run' })
  userId?: string;

  @ApiProperty({ description: 'Original design query' })
  query!: string;

  @ApiProperty({ description: 'Provider used for this run' })
  provider!: string;

  @ApiProperty({ description: 'Model used for this run' })
  model!: string;

  @ApiProperty({
    description: 'Run status',
    enum: ['running', 'completed', 'failed'],
  })
  status!: 'running' | 'completed' | 'failed';

  @ApiProperty({ description: 'Run start timestamp (ISO)' })
  startedAt!: string;

  @ApiPropertyOptional({ description: 'Run end timestamp (ISO)' })
  endedAt?: string;

  @ApiPropertyOptional({ description: 'Run duration in milliseconds' })
  durationMs?: number;

  @ApiPropertyOptional({
    description: 'Result details when run completed successfully',
    type: AgentDebugRunResultDto,
  })
  result?: AgentDebugRunResultDto;

  @ApiPropertyOptional({ description: 'Error message when run failed' })
  error?: string;
}

export class AgentDebugRunStageDto {
  @ApiProperty({ description: 'Stage timestamp (ISO)' })
  timestamp!: string;

  @ApiProperty({ description: 'Stage name' })
  name!: string;

  @ApiPropertyOptional({
    description: 'Sanitized stage payload',
    type: 'object',
    additionalProperties: true,
  })
  data?: Record<string, unknown>;
}

export class AgentDebugToolReplayStepDto {
  @ApiProperty({ description: 'Tool name invoked by the agent' })
  tool!: string;

  @ApiProperty({
    description: 'Tool input payload',
    type: 'object',
    additionalProperties: true,
  })
  toolInput!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Sanitized tool observation payload',
    type: 'object',
    additionalProperties: true,
  })
  observation?: Record<string, unknown>;
}

export class AgentDebugRunDetailDto extends AgentDebugRunSummaryDto {
  @ApiProperty({
    description: 'Chronological stage timeline for this run',
    type: [AgentDebugRunStageDto],
  })
  stages!: AgentDebugRunStageDto[];

  @ApiProperty({
    description: 'Tool replay entries captured for this run',
    type: [AgentDebugToolReplayStepDto],
  })
  toolReplay!: AgentDebugToolReplayStepDto[];
}

export class AgentDebugRunListResponseDto {
  @ApiProperty({
    description: 'Recent run summaries for the authenticated user',
    type: [AgentDebugRunSummaryDto],
  })
  runs!: AgentDebugRunSummaryDto[];

  @ApiProperty({ description: 'Number of runs returned' })
  count!: number;

  @ApiProperty({ description: 'Response timestamp (ISO)' })
  timestamp!: string;
}

export class AgentDebugRunDetailResponseDto {
  @ApiProperty({
    description: 'Detailed run payload including timeline and tool replay',
    type: AgentDebugRunDetailDto,
  })
  run!: AgentDebugRunDetailDto;

  @ApiProperty({ description: 'Response timestamp (ISO)' })
  timestamp!: string;
}
