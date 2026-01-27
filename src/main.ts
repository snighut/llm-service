import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app: INestApplication = await NestFactory.create(AppModule);

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

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}/api/v1`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error('Application failed to start:', error.message);
    console.error(error.stack);
  } else {
    console.error('Application failed to start with an unknown error:', error);
  }
});
