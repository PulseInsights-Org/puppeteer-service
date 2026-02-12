/**
 * Unit tests for src/index.js (puppeteer router)
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const mockCloseAllBrowsers = jest.fn().mockResolvedValue(undefined);
const mockSetShuttingDown = jest.fn();
const mockGetShuttingDown = jest.fn().mockReturnValue(false);

jest.mock('../../src/services/browser', () => ({
  closeAllBrowsers: (...args) => mockCloseAllBrowsers(...args),
  setShuttingDown: (...args) => mockSetShuttingDown(...args),
  getShuttingDown: () => mockGetShuttingDown()
}));

jest.mock('../../src/routes/fill-rfq', () => {
  const router = require('express').Router();
  router.post('/', (req, res) => res.json({ success: true }));
  router.get('/error', (req, res, next) => {
    next(new Error('Test triggered error'));
  });
  return router;
});

jest.mock('../../src/middleware/rate-limiter', () => ({
  rateLimit: () => (req, res, next) => next()
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/puppeteer', require('../../src/index'));
  return app;
}

describe('Puppeteer Router (src/index.js)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetShuttingDown.mockReturnValue(false);
    app = createApp();
  });

  describe('GET /puppeteer/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/puppeteer/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('puppeteer');
      expect(response.body.version).toBe('1.0.0');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
      expect(response.body.memory).toBeDefined();
      expect(response.body.memory.unit).toBe('MB');
    });

    it('should report environment correctly', async () => {
      const response = await request(app)
        .get('/puppeteer/health')
        .expect(200);

      expect(response.body.environment).toBe('development');
    });
  });

  describe('GET /puppeteer/ready', () => {
    it('should return ready when not shutting down', async () => {
      const response = await request(app)
        .get('/puppeteer/ready')
        .expect(200);

      expect(response.body).toEqual({ ready: true });
    });

    it('should return 503 when shutting down', async () => {
      mockGetShuttingDown.mockReturnValue(true);

      const response = await request(app)
        .get('/puppeteer/ready')
        .expect(503);

      expect(response.body).toEqual({ ready: false, reason: 'shutting_down' });
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unknown puppeteer paths', async () => {
      const response = await request(app)
        .get('/puppeteer/nonexistent')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Puppeteer endpoint not found');
      expect(response.body.path).toBeDefined();
    });
  });

  describe('error handler', () => {
    it('should return 500 for unhandled errors', async () => {
      const response = await request(app)
        .get('/puppeteer/fill-rfq/error')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('graceful shutdown', () => {
    it('should export the router', () => {
      const router = require('../../src/index');
      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });
  });
});
