import winston from 'winston';
import { hostname } from 'os';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FORMAT = process.env.LOG_FORMAT || 'json';
const NODE_ENV = process.env.NODE_ENV || 'production';

// Custom format for errors
const errorFormat = winston.format((info) => {
  if (info.error instanceof Error) {
    info.error = {
      ...info.error,
      stack: info.error.stack,
    };
  }
  return info;
});

// Create formatters
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  errorFormat(),
  winston.format.json(),
);

const prettyFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    return log;
  }),
);

// Create logger instance
export const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: {
    service: 'argo-mcp-server',
    hostname: hostname(),
    pid: process.pid,
    env: NODE_ENV,
  },
  format: LOG_FORMAT === 'json' ? jsonFormat : prettyFormat,
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false,
});

// Create child logger factory
export function createLogger(component: string): winston.Logger {
  return logger.child({ component });
}

// Log unhandled errors
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled rejection', { reason, promise });
});