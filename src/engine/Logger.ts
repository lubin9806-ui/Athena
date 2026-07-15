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
    const safeMessage = redactLogValue(message);
    const safeArgs = args.map(redactLogArgument);

    try {
      switch (level) {
        case 'debug': console.debug(prefix, safeMessage, ...safeArgs); break;
        case 'info': console.info(prefix, safeMessage, ...safeArgs); break;
        case 'warn': console.warn(prefix, safeMessage, ...safeArgs); break;
        case 'error': console.error(prefix, safeMessage, ...safeArgs); break;
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

export function redactLogValue(value: string): string {
  return value
    .replace(/(authorization|cookie|password|passwd|passphrase|secret|token|api[_-]?key|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b(?:sk|sk-proj)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_KEY]')
    .replace(/https?:\/\/([^\s/:@]+):([^\s/@]+)@/gi, 'https://REDACTED:REDACTED@');
}

function redactLogArgument(value: unknown): unknown {
  if (typeof value === 'string') return redactLogValue(value);
  if (value instanceof Error) return { name: value.name, message: redactLogValue(value.message) };
  if (!value || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value, (key, child) => (
      /authorization|cookie|password|passwd|passphrase|secret|token|api[_-]?key|credential/i.test(key)
        ? '[REDACTED]'
        : typeof child === 'string' ? redactLogValue(child) : child
    )));
  } catch {
    return '[unserializable diagnostic omitted]';
  }
}
