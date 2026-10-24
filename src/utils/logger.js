/**
 * Simple structured console logger with timestamps and log levels.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const currentLevel = process.env.NODE_ENV === 'test' ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;

function formatMessage(level, message) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level}] ${message}`;
}

export const logger = {
  debug: (...args) => {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
      console.debug(formatMessage('DEBUG', args.join(' ')));
    }
  },
  info: (...args) => {
    if (currentLevel <= LOG_LEVELS.INFO) {
      console.log(formatMessage('INFO', args.join(' ')));
    }
  },
  warn: (...args) => {
    if (currentLevel <= LOG_LEVELS.WARN) {
      console.warn(formatMessage('WARN', args.join(' ')));
    }
  },
  error: (...args) => {
    if (currentLevel <= LOG_LEVELS.ERROR) {
      console.error(formatMessage('ERROR', args.join(' ')));
    }
  }
};

export default logger;
