// Log process exit and beforeExit events for debugging
process.on('exit', (code) => {
  console.error(
    'Process exit event with code:',
    code,
    new Error('Stack trace for exit'),
  );
});
process.on('beforeExit', (code) => {
  console.error(
    'Process beforeExit event with code:',
    code,
    new Error('Stack trace for beforeExit'),
  );
});
import 'dotenv/config';

// Log unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception thrown:', err);
  process.exit(1);
});
import { NestFactory } from '@nestjs/core';
import {
  INestApplication,
  ValidationPipe,
  HttpException,
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Inject,
} from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LoggerService } from './logs/logger.service';

@Catch()
class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LoggerService) private readonly logger: LoggerService) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response: {
      status: (code: number) => { json: (body: any) => void };
    } = ctx.getResponse();
    const request: { url: string } = ctx.getRequest();
    const status: number =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message: string =
      exception instanceof HttpException
        ? exception.message
        : typeof exception === 'object' &&
            exception !== null &&
            'message' in exception
          ? (exception as { message: string }).message
          : 'Unknown error';
    const stack: string =
      typeof exception === 'object' &&
      exception !== null &&
      'stack' in exception
        ? (exception as { stack: string }).stack
        : '';
    this.logger.error(`Boundary error: ${message}`, stack);
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}

async function bootstrap() {
  // bootstrap start
  let app: INestApplication;
  try {
    app = await NestFactory.create(AppModule, {
      logger: false,
    });
    // bootstrap after NestFactory.create
  } catch (err) {
    console.error('Error during NestFactory.create:', err);
    throw err;
  }
  app.useLogger(app.get(LoggerService));
  app.useGlobalFilters(new AllExceptionsFilter(app.get(LoggerService)));

  // Security
  app.use(helmet());

  // CORS - configure for your frontend
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Global prefix for all routes
  app.setGlobalPrefix('api/v1');

  // Swagger/OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle('LLM Service API')
    .setDescription('API for Large Language Model service endpoints')
    .setVersion('1.0.0')
    .addTag('llm', 'LLM endpoints')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = process.env.PORT || 3002;
  // About to call app.listen...
  await app.listen(port, '0.0.0.0');
  // app.listen resolved, server should be running.

  const logger = app.get(LoggerService);
  logger.log(`🚀 Application is running on: http://localhost:${port}/api/v1`);
  logger.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
