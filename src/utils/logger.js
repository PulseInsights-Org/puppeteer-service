/**
 * Puppeteer Service - Logger Utility
 * Isolated logging for puppeteer service operations
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const CURRENT_LOG_LEVEL = LOG_LEVELS[process.env.PUPPETEER_LOG_LEVEL] ?? (IS_PRODUCTION ? LOG_LEVELS.info : LOG_LEVELS.debug);

function log(level, message, meta = {}) {
  if (LOG_LEVELS[level] > CURRENT_LOG_LEVEL) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    service: 'puppeteer',
    message,
    ...meta
  };

  const formatted = IS_PRODUCTION
    ? JSON.stringify(entry)
    : `[${entry.timestamp}] [PUPPETEER] [${entry.level}] ${message}${Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''}`;

  if (level === 'error') {
    console.error(formatted);
  } else {
    console.log(formatted);
  }
}

module.exports = {
  log,
  error: (message, meta) => log('error', message, meta),
  warn: (message, meta) => log('warn', message, meta),
  info: (message, meta) => log('info', message, meta),
  debug: (message, meta) => log('debug', message, meta)
};
