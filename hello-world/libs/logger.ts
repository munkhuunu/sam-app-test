/**
 * libs/logger.ts
 * Structured JSON logger — every line is a CloudWatch Logs Insights-queryable JSON object.
 *
 * ENV:  LOG_LEVEL = DEBUG | INFO | WARN | ERROR  (default: INFO)
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogContext {
  requestId?: string;
  userId?: string;
  method?: string;
  path?: string;
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

const isValidLogLevel = (v: unknown): v is LogLevel =>
  typeof v === 'string' && v in LEVEL_PRIORITY;

const MIN_LEVEL: LogLevel = isValidLogLevel(process.env.LOG_LEVEL)
  ? process.env.LOG_LEVEL
  : 'INFO';

function emit(level: LogLevel, message: string, ctx: LogContext, extra?: Record<string, unknown>) {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[MIN_LEVEL]) return;
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    service: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local',
    ...ctx,
    ...extra,
  }));
}

export class Logger {
  constructor(private ctx: LogContext = {}) {}
  child(extra: LogContext) { return new Logger({ ...this.ctx, ...extra }); }
  debug(msg: string, extra?: Record<string, unknown>) { emit('DEBUG', msg, this.ctx, extra); }
  info (msg: string, extra?: Record<string, unknown>) { emit('INFO',  msg, this.ctx, extra); }
  warn (msg: string, extra?: Record<string, unknown>) { emit('WARN',  msg, this.ctx, extra); }
  error(msg: string, extra?: Record<string, unknown>) { emit('ERROR', msg, this.ctx, extra); }
}

export const logger = new Logger();
