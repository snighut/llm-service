import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmModule } from './llm/llm.module';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
import { LoggerModule } from './logs/logger.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { IngestionModule } from './ingestion/ingestion.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Database (TypeORM + Postgres)
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DATABASE_HOST'),
        port: configService.get('DATABASE_PORT'),
        username: configService.get('DATABASE_USER'),
        password: configService.get('DATABASE_PASSWORD'),
        database: configService.get('DATABASE_NAME'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get('NODE_ENV') === 'development',
        logging: false,
      }),
      inject: [ConfigService],
    }),

    // Feature Modules
    LoggerModule,
    LlmModule,
    AgentModule,
    AuthModule,
    QueueModule,
    StorageModule,
    IngestionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
