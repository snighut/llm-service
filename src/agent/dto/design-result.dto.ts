import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}

export class DesignErrorDto {
  @ApiProperty({ description: 'Error message' })
  error: string;

  @ApiProperty({ description: 'Detailed error information' })
  details: string;

  @ApiProperty({ description: 'HTTP status code' })
  statusCode: number;
}
