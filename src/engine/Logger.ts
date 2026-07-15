/** 日志系统 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let outputGuardsInstalled = false;

export function installLoggingPipeGuards(): void {
  if (outputGuardsInstalled) return;
  outputGuardsInstalled = true;

  const absorbOutputError = (_error: NodeJS.ErrnoException): void => {
    // Logging is a diagnostic side channel. A closed console pipe must never
    // crash the Electron main process or show a JavaScript error dialog.
  };
  process.stdout?.on('error', absorbOutputError);
  process.stderr?.on('error', absorbOutputError);
}

installLoggingPipeGuards();

class Logger {
  private level: LogLevel = 'info';
  private context: string;

  constructor(context: string = 'Athena') {
    this.context = context;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private log(level: LogLevel, message: string, ...args: any[]): void {
    if (LOG_LEVELS[level] < LOG_LEVELS[this.level]) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.context}]`;

    try {
      switch (level) {
        case 'debug': console.debug(prefix, message, ...args); break;
        case 'info': console.info(prefix, message, ...args); break;
        case 'warn': console.warn(prefix, message, ...args); break;
        case 'error': console.error(prefix, message, ...args); break;
      }
    } catch {
      // Console output can synchronously fail when a parent shell closes.
    }
  }

  debug(message: string, ...args: any[]): void { this.log('debug', message, ...args); }
  info(message: string, ...args: any[]): void { this.log('info', message, ...args); }
  warn(message: string, ...args: any[]): void { this.log('warn', message, ...args); }
  error(message: string, ...args: any[]): void { this.log('error', message, ...args); }
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}

export const mainLogger = createLogger('Main');
