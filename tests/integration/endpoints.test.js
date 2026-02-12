/**
 * Integration tests for all API endpoints
 */

const request = require('supertest');
const express = require('express');

// Store original mocks
let mockGetShuttingDown = jest.fn().mockReturnValue(false);
let mockIsConfigured = jest.fn().mockReturnValue(true);
let mockLaunchBrowser = jest.fn();
let mockSetupPage = jest.fn();
let mockCloseBrowser = jest.fn();
let mockFillRfqForm = jest.fn();
let mockCancelFormSubmission = jest.fn();
let mockCaptureAndUploadScreenshot = jest.fn();

// Mock the browser and screenshot services before requiring the app
jest.mock('../../src/services/browser', () => ({
  launchBrowser: (...args) => mockLaunchBrowser(...args),
  setupPage: (...args) => mockSetupPage(...args),
  closeBrowser: (...args) => mockCloseBrowser(...args),
  closeAllBrowsers: jest.fn(),
  setShuttingDown: jest.fn(),
  getShuttingDown: () => mockGetShuttingDown()
}));

jest.mock('../../src/services/screenshot', () => ({
  captureAndUploadScreenshot: (...args) => mockCaptureAndUploadScreenshot(...args),
  isConfigured: () => mockIsConfigured()
}));

jest.mock('../../src/middleware/rate-limiter', () => ({
  rateLimit: () => (req, res, next) => next()
}));

jest.mock('../../src/services/form-filler', () => ({
  fillRfqForm: (...args) => mockFillRfqForm(...args),
  cancelFormSubmission: (...args) => mockCancelFormSubmission(...args),
  submitForm: jest.fn().mockResolvedValue(true),
  delay: jest.fn().mockResolvedValue(undefined)
}));

// Create app after mocks are set up
function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // CORS middleware
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-RFQ-ID, X-Request-ID');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Root health check
  app.get('/', (req, res) => {
    res.json({
      service: 'puppeteer-service',
      status: 'running',
      version: '1.0.0',
      endpoints: {
        health: '/puppeteer/health',
        ready: '/puppeteer/ready',
        fillRfq: 'POST /puppeteer/fill-rfq'
      }
    });
  });

  // Mount puppeteer router
  const puppeteerRouter = require('../../src/index');
  app.use('/puppeteer', puppeteerRouter);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      path: req.path
    });
  });

  return app;
}

describe('API Endpoints', () => {
  let app;

  beforeEach(() => {
    // Reset all mocks
    mockGetShuttingDown = jest.fn().mockReturnValue(false);
    mockIsConfigured = jest.fn().mockReturnValue(true);
    mockLaunchBrowser = jest.fn();
    mockSetupPage = jest.fn();
    mockCloseBrowser = jest.fn();
    mockFillRfqForm = jest.fn();
    mockCancelFormSubmission = jest.fn();
    mockCaptureAndUploadScreenshot = jest.fn();

    jest.clearAllMocks();
    app = createApp();
  });

  describe('GET / (Root Health Check)', () => {
    it('should return service information', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body).toEqual({
        service: 'puppeteer-service',
        status: 'running',
        version: '1.0.0',
        endpoints: {
          health: '/puppeteer/health',
          ready: '/puppeteer/ready',
          fillRfq: 'POST /puppeteer/fill-rfq'
        }
      });
    });

    it('should return JSON content type', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('GET /puppeteer/health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/puppeteer/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('puppeteer');
      expect(response.body.version).toBe('1.0.0');
    });

    it('should include timestamp in ISO format', async () => {
      const response = await request(app)
        .get('/puppeteer/health')
        .expect(200);

      expect(response.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include uptime', async () => {
      const response = await request(app)
        .get('/puppeteer/health')
        .expect(200);

      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should include memory information', async () => {
      const response = await request(app)
        .get('/puppeteer/health')
        .expect(200);

      expect(response.body.memory).toBeDefined();
      expect(response.body.memory.heapUsed).toBeDefined();
      expect(response.body.memory.heapTotal).toBeDefined();
      expect(response.body.memory.unit).toBe('MB');
    });

    it('should include environment information', async () => {
      const response = await request(app)
        .get('/puppeteer/health')
        .expect(200);

      expect(['development', 'production', 'test']).toContain(response.body.environment);
    });
  });

  describe('GET /puppeteer/ready', () => {
    it('should return ready status when not shutting down', async () => {
      mockGetShuttingDown.mockReturnValue(false);

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

      expect(response.body).toEqual({
        ready: false,
        reason: 'shutting_down'
      });
    });
  });

  describe('POST /puppeteer/fill-rfq', () => {
    const validPayload = {
      rfq_details: {
        quote_submission_url: 'https://example.com/rfq-form'
      },
      quote_details: {
        items: [
          {
            part_no: 'TEST-001',
            qty_available: '100',
            price_usd: '25.00'
          }
        ]
      }
    };

    const validHeaders = {
      'Content-Type': 'application/json',
      'X-RFQ-ID': 'test-rfq-123'
    };

    describe('validation', () => {
      it('should return 400 when X-RFQ-ID header is missing', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .send(validPayload)
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('X-RFQ-ID');
      });

      it('should return 400 when body is empty', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send({})
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors).toBeDefined();
      });

      it('should return 400 when rfq_details is missing', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send({ quote_details: {} })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors).toContain('rfq_details is required');
      });

      it('should return 400 when quote_submission_url is missing', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send({
            rfq_details: {},
            quote_details: {}
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors).toContain('rfq_details.quote_submission_url is required');
      });

      it('should return 400 when URL is invalid', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send({
            rfq_details: { quote_submission_url: 'not-a-url' },
            quote_details: {}
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors).toContain('rfq_details.quote_submission_url must be a valid URL');
      });

      it('should return 400 when items is not an array', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send({
            rfq_details: { quote_submission_url: 'https://example.com/form' },
            quote_details: { items: 'not-an-array' }
          })
          .expect(400);

        expect(response.body.success).toBe(false);
        expect(response.body.errors).toContain('quote_details.items must be an array');
      });
    });

    describe('Supabase configuration', () => {
      it('should return 503 when Supabase is not configured', async () => {
        mockIsConfigured.mockReturnValue(false);

        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(503);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Supabase not configured');
      });
    });

    describe('successful form fill', () => {
      beforeEach(() => {
        const mockPage = {
          goto: jest.fn().mockResolvedValue({ status: () => 200 }),
          waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined)
        };

        const mockBrowser = {
          close: jest.fn().mockResolvedValue(undefined)
        };

        mockLaunchBrowser.mockResolvedValue(mockBrowser);
        mockSetupPage.mockResolvedValue(mockPage);
        mockCloseBrowser.mockResolvedValue(undefined);
        mockFillRfqForm.mockResolvedValue(undefined);
        mockCancelFormSubmission.mockResolvedValue(undefined);
        mockCaptureAndUploadScreenshot.mockResolvedValue({
          url: 'https://test.supabase.co/storage/v1/object/public/rfq-artifacts/screenshots/test.png',
          type: 'filled',
          captured_at: new Date().toISOString(),
          storage_path: 'screenshots/test-rfq-123/rfq-filled-123456.png'
        });
      });

      it('should return 200 on successful form fill', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Form filled and cancelled successfully');
        expect(response.body.requestId).toBeDefined();
        expect(response.body.screenshot_data).toBeDefined();
        expect(Array.isArray(response.body.screenshot_data)).toBe(true);
      });

      it('should include screenshot data in response', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(200);

        expect(response.body.screenshot_data[0]).toHaveProperty('url');
        expect(response.body.screenshot_data[0]).toHaveProperty('type', 'filled');
        expect(response.body.screenshot_data[0]).toHaveProperty('form_url', validPayload.rfq_details.quote_submission_url);
      });

      it('should return X-Request-ID header', async () => {
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(200);

        expect(response.headers['x-request-id']).toBeDefined();
      });

      it('should use provided X-Request-ID header', async () => {
        const customRequestId = 'custom-request-id-123';
        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set({ ...validHeaders, 'X-Request-ID': customRequestId })
          .send(validPayload)
          .expect(200);

        expect(response.headers['x-request-id']).toBe(customRequestId);
        expect(response.body.requestId).toBe(customRequestId);
      });
    });

    describe('error handling', () => {
      it('should return 500 when browser launch fails', async () => {
        mockLaunchBrowser.mockRejectedValue(new Error('Failed to launch browser'));

        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(500);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Failed to launch browser');
      });

      it('should return 500 when navigation fails after retries', async () => {
        const mockPage = {
          goto: jest.fn().mockRejectedValue(new Error('Navigation failed')),
          close: jest.fn().mockResolvedValue(undefined)
        };

        const mockBrowser = {
          close: jest.fn().mockResolvedValue(undefined)
        };

        mockLaunchBrowser.mockResolvedValue(mockBrowser);
        mockSetupPage.mockResolvedValue(mockPage);
        mockCloseBrowser.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(500);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('Failed to navigate');
      });

      it('should return 500 when form fill fails', async () => {
        const mockPage = {
          goto: jest.fn().mockResolvedValue({ status: () => 200 }),
          waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined)
        };

        const mockBrowser = {
          close: jest.fn().mockResolvedValue(undefined)
        };

        mockLaunchBrowser.mockResolvedValue(mockBrowser);
        mockSetupPage.mockResolvedValue(mockPage);
        mockCloseBrowser.mockResolvedValue(undefined);
        mockFillRfqForm.mockRejectedValue(new Error('Form fill failed'));

        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(500);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toBe('Form fill failed');
      });

      it('should close browser even when error occurs', async () => {
        const mockPage = {
          goto: jest.fn().mockResolvedValue({ status: () => 200 }),
          waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
          close: jest.fn().mockResolvedValue(undefined)
        };

        const mockBrowser = {
          close: jest.fn().mockResolvedValue(undefined)
        };

        mockLaunchBrowser.mockResolvedValue(mockBrowser);
        mockSetupPage.mockResolvedValue(mockPage);
        mockCloseBrowser.mockResolvedValue(undefined);
        mockFillRfqForm.mockRejectedValue(new Error('Form fill failed'));

        await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(500);

        expect(mockCloseBrowser).toHaveBeenCalledWith(mockBrowser, expect.any(String));
      });
    });

    describe('shutdown handling', () => {
      it('should return 503 when service is shutting down', async () => {
        mockGetShuttingDown.mockReturnValue(true);

        const response = await request(app)
          .post('/puppeteer/fill-rfq')
          .set(validHeaders)
          .send(validPayload)
          .expect(503);

        expect(response.body.success).toBe(false);
        expect(response.body.error).toContain('shutting down');
      });
    });
  });

  describe('404 Not Found', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await request(app)
        .get('/unknown-endpoint')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Endpoint not found');
    });

    it('should return 404 for unknown puppeteer endpoints', async () => {
      const response = await request(app)
        .get('/puppeteer/unknown')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Puppeteer endpoint not found');
    });

    it('should include path in 404 response', async () => {
      const response = await request(app)
        .get('/puppeteer/nonexistent')
        .expect(404);

      expect(response.body.path).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('should handle OPTIONS preflight request', async () => {
      const response = await request(app)
        .options('/puppeteer/fill-rfq')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toContain('POST');
      expect(response.headers['access-control-allow-headers']).toContain('X-RFQ-ID');
    });

    it('should include CORS headers in responses', async () => {
      const response = await request(app)
        .get('/puppeteer/health')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});
