// Structured logger for merchant acquisition engine
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

function formatLog(level: LogLevel, event: string, data?: Record<string, any>): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${event}${dataStr}`;
}

export const logger = {
  debug(event: string, data?: Record<string, any>) {
    console.log(formatLog('debug', event, data));
  },
  info(event: string, data?: Record<string, any>) {
    console.log(formatLog('info', event, data));
  },
  warn(event: string, data?: Record<string, any>) {
    console.warn(formatLog('warn', event, data));
  },
  error(event: string, data?: Record<string, any>) {
    console.error(formatLog('error', event, data));
  }
};
