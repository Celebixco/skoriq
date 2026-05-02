import type { LogLevel } from "@sports-data/shared";

export interface LogContext {
  [key: string]: unknown;
}

export interface AppLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const severity: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(minLevel: LogLevel = "info"): AppLogger {
  function write(level: LogLevel, message: string, context: LogContext = {}) {
    if (severity[level] < severity[minLevel]) {
      return;
    }

    const payload = {
      level,
      message,
      time: new Date().toISOString(),
      ...context
    };

    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context)
  };
}
