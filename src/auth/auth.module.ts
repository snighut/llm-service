import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { LoggerService } from '../logs/logger.service';

@Module({
  providers: [SupabaseAuthGuard, LoggerService],
  exports: [SupabaseAuthGuard],
})
export class AuthModule {}
