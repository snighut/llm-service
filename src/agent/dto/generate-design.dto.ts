import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateDesignOptionsDto {
  @ApiPropertyOptional({
    description: 'Whether to search and use existing design templates',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  useTemplates?: boolean = true;

  @ApiPropertyOptional({
    description: 'Enable web search for architecture patterns',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enableWebSearch?: boolean = false;

  @ApiPropertyOptional({
    description: 'Maximum number of components to generate',
    default: 20,
  })
  @IsOptional()
  @IsNumber()
  maxComponents?: number = 20;

  @ApiPropertyOptional({
    description: 'Maximum number of iterations for agent reasoning',
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  maxIterations?: number = 10;
}

export class GenerateDesignDto {
  @ApiProperty({
    description: 'Natural language description of the system to design',
    example:
      'Design a microservices architecture for an e-commerce platform with payment processing',
  })
  @IsString()
  query: string;

  @ApiPropertyOptional({
    description: 'Options for design generation',
    type: GenerateDesignOptionsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => GenerateDesignOptionsDto)
  options?: GenerateDesignOptionsDto;
}
