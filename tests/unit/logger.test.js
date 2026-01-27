/**
 * Unit tests for logger utility
 */

describe('Logger Utility', () => {
  let logger;
  let consoleSpy;
  let consoleErrorSpy;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('log levels', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'debug' };
      logger = require('../../src/utils/logger');
    });

    it('should log error messages', () => {
      logger.error('Test error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('ERROR');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('Test error message');
    });

    it('should log warn messages', () => {
      logger.warn('Test warn message');
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('WARN');
      expect(consoleSpy.mock.calls[0][0]).toContain('Test warn message');
    });

    it('should log info messages', () => {
      logger.info('Test info message');
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('INFO');
      expect(consoleSpy.mock.calls[0][0]).toContain('Test info message');
    });

    it('should log debug messages', () => {
      logger.debug('Test debug message');
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('DEBUG');
      expect(consoleSpy.mock.calls[0][0]).toContain('Test debug message');
    });
  });

  describe('log with metadata', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'debug' };
      logger = require('../../src/utils/logger');
    });

    it('should include metadata in log output', () => {
      logger.info('Test with meta', { requestId: '123', action: 'test' });
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('requestId');
      expect(output).toContain('123');
    });

    it('should handle empty metadata', () => {
      logger.info('Test without meta');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should handle complex metadata objects', () => {
      logger.info('Complex meta', {
        nested: { key: 'value' },
        array: [1, 2, 3]
      });
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('log formatting', () => {
    it('should include timestamp in output', () => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'debug' };
      logger = require('../../src/utils/logger');

      logger.info('Timestamp test');
      expect(consoleSpy).toHaveBeenCalled();
      // Check that output contains ISO timestamp pattern
      expect(consoleSpy.mock.calls[0][0]).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include PUPPETEER service identifier', () => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'debug' };
      logger = require('../../src/utils/logger');

      logger.info('Service test');
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('PUPPETEER');
    });
  });

  describe('production format', () => {
    it('should output JSON in production mode', () => {
      process.env = { ...originalEnv, NODE_ENV: 'production', PUPPETEER_LOG_LEVEL: 'info' };
      jest.resetModules();
      logger = require('../../src/utils/logger');

      logger.info('Production test', { key: 'value' });
      expect(consoleSpy).toHaveBeenCalled();

      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.service).toBe('puppeteer');
      expect(parsed.message).toBe('Production test');
      expect(parsed.key).toBe('value');
      expect(parsed.level).toBe('INFO');
    });
  });

  describe('log level filtering', () => {
    it('should not log debug when level is info', () => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'info' };
      jest.resetModules();
      logger = require('../../src/utils/logger');

      logger.debug('Should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should not log info when level is warn', () => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'warn' };
      jest.resetModules();
      logger = require('../../src/utils/logger');

      logger.info('Should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should not log warn when level is error', () => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'error' };
      jest.resetModules();
      logger = require('../../src/utils/logger');

      logger.warn('Should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should always log errors regardless of level', () => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'error' };
      jest.resetModules();
      logger = require('../../src/utils/logger');

      logger.error('Should appear');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('log function directly', () => {
    beforeEach(() => {
      process.env = { ...originalEnv, NODE_ENV: 'test', PUPPETEER_LOG_LEVEL: 'debug' };
      logger = require('../../src/utils/logger');
    });

    it('should expose log function', () => {
      expect(typeof logger.log).toBe('function');
    });

    it('should use log function directly', () => {
      logger.log('info', 'Direct log test');
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
