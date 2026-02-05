import { Injectable, ConsoleLogger } from '@nestjs/common';
import logger from './logger';

@Injectable()
export class LoggerService extends ConsoleLogger {
  constructor() {
    super();
  }

  log(message: string) {
    logger.info(message);
  }

  error(message: string, trace?: string) {
    logger.error(message, { trace });
  }

  warn(message: string) {
    logger.warn(message);
  }

  debug(message: string) {
    logger.debug(message);
  }

  verbose(message: string) {
    logger.verbose(message);
  }
}
