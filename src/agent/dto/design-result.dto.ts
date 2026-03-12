import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidationAttemptSummaryDto {
  @ApiProperty({ description: 'Attempt index (1-based)' })
  attempt: number;

  @ApiProperty({ description: 'Design ID generated in this attempt' })
  designId: string;

  @ApiProperty({ description: 'Validation score for this attempt' })
  validationScore: number;

  @ApiProperty({ description: 'Whether this attempt passed validator checks' })
  passed: boolean;

  @ApiProperty({ description: 'Count of missing requirements in this attempt' })
  missingRequirementsCount: number;

  @ApiProperty({ description: 'Count of detected gaps in this attempt' })
  gapCount: number;
}

export class ValidationDetailsDto {
  @ApiProperty({ description: 'Final validator score (0-100)' })
  score: number;

  @ApiProperty({
    description: 'Whether final validator pass criteria were met',
  })
  passed: boolean;

  @ApiProperty({
    description: 'Requirements identified as missing in final selection',
    type: [String],
  })
  missingRequirements: string[];

  @ApiProperty({
    description: 'Architecture gaps identified in final selection',
    type: [String],
  })
  gaps: string[];

  @ApiProperty({
    description: 'Actionable improvement recommendations from validator',
    type: [String],
  })
  recommendations: string[];

  @ApiPropertyOptional({
    description: 'Per-attempt validation summary for multi-agent retries',
    type: [ValidationAttemptSummaryDto],
  })
  attempts?: ValidationAttemptSummaryDto[];
}

export class DesignResultMetadataDto {
  @ApiProperty({ description: 'Number of components created' })
  componentsCount: number;

  @ApiProperty({ description: 'Number of connections created' })
  connectionsCount: number;

  @ApiProperty({ description: 'Processing time in milliseconds' })
  processingTimeMs: number;

  @ApiPropertyOptional({ description: 'Whether a template was used' })
  templateUsed?: boolean;

  @ApiPropertyOptional({ description: 'Template ID if used' })
  templateId?: string;

  @ApiPropertyOptional({ description: 'Validation score (0-100)' })
  validationScore?: number;

  @ApiPropertyOptional({
    description: 'ADR identifier linked to generated design',
  })
  adrId?: string;

  @ApiPropertyOptional({
    description: 'Validator threshold used for acceptance',
  })
  validationThreshold?: number;

  @ApiPropertyOptional({ description: 'Whether final score met threshold' })
  thresholdMet?: boolean;

  @ApiPropertyOptional({ description: 'Number of refinement retries consumed' })
  refinementCyclesUsed?: number;
}

export class DesignResultDto {
  @ApiProperty({ description: 'UUID of the created design' })
  designId: string;

  @ApiProperty({ description: 'Name of the created design' })
  name: string;

  @ApiProperty({ description: 'Success message' })
  message: string;

  @ApiPropertyOptional({ description: 'Agent reasoning steps', type: [String] })
  reasoning?: string[];

  @ApiProperty({
    description: 'Metadata about the generation process',
    type: DesignResultMetadataDto,
  })
  metadata: DesignResultMetadataDto;

  @ApiPropertyOptional({
    description: 'Detailed validation and expectation coverage information',
    type: ValidationDetailsDto,
  })
  validationDetails?: ValidationDetailsDto;
}

export class DesignErrorDto {
  @ApiProperty({ description: 'Error message' })
  error: string;

  @ApiProperty({ description: 'Detailed error information' })
  details: string;

  @ApiProperty({ description: 'HTTP status code' })
  statusCode: number;
}
