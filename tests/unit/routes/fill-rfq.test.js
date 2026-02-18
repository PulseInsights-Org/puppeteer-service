/**
 * Unit tests for fill-rfq route
 */

const express = require('express');
const request = require('supertest');

// Mocks
const mockLaunchBrowser = jest.fn();
const mockSetupPage = jest.fn();
const mockCloseBrowser = jest.fn();
const mockGetShuttingDown = jest.fn().mockReturnValue(false);
const mockFillRfqForm = jest.fn().mockResolvedValue(undefined);
const mockCancelFormSubmission = jest.fn().mockResolvedValue(undefined);
const mockSubmitForm = jest.fn().mockResolvedValue(true);
const mockDelay = jest.fn().mockResolvedValue(undefined);
const mockCaptureAndUploadScreenshot = jest.fn();
const mockIsConfigured = jest.fn().mockReturnValue(true);
const mockGenerateIdempotencyKey = jest.fn().mockReturnValue('test-key');
const mockCheckIdempotency = jest.fn().mockReturnValue(null);
const mockStartProcessing = jest.fn().mockReturnValue(true);
const mockMarkCompleted = jest.fn();
const mockMarkFailed = jest.fn();
const mockRemoveKey = jest.fn();

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../src/utils/validation', () => ({
  validateRfqRequest: jest.requireActual('../../../src/utils/validation').validateRfqRequest
}));

jest.mock('../../../src/middleware/rate-limiter', () => ({
  rateLimit: () => (req, res, next) => next()
}));

jest.mock('../../../src/services/browser', () => ({
  launchBrowser: (...args) => mockLaunchBrowser(...args),
  setupPage: (...args) => mockSetupPage(...args),
  closeBrowser: (...args) => mockCloseBrowser(...args),
  getShuttingDown: () => mockGetShuttingDown(),
  DEFAULT_TIMEOUT: 120000,
  VIEWPORT: { width: 1920, height: 1080 }
}));

jest.mock('../../../src/services/form-filler', () => ({
  fillRfqForm: (...args) => mockFillRfqForm(...args),
  cancelFormSubmission: (...args) => mockCancelFormSubmission(...args),
  submitForm: (...args) => mockSubmitForm(...args),
  delay: (...args) => mockDelay(...args)
}));

jest.mock('../../../src/services/screenshot', () => ({
  captureAndUploadScreenshot: (...args) => mockCaptureAndUploadScreenshot(...args),
  isConfigured: () => mockIsConfigured()
}));

jest.mock('../../../src/services/idempotency', () => ({
  generateIdempotencyKey: (...args) => mockGenerateIdempotencyKey(...args),
  checkIdempotency: (...args) => mockCheckIdempotency(...args),
  startProcessing: (...args) => mockStartProcessing(...args),
  markCompleted: (...args) => mockMarkCompleted(...args),
  markFailed: (...args) => mockMarkFailed(...args),
  removeKey: (...args) => mockRemoveKey(...args)
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/fill-rfq', require('../../../src/routes/fill-rfq'));
  return app;
}

describe('Fill RFQ Route', () => {
  let app;
  let mockPage;
  let mockBrowser;

  const validPayload = {
    rfq_details: { quote_submission_url: 'https://example.com/rfq-form' },
    quote_details: {
      items: [{ part_no: 'TEST-001', qty_available: '100', price_usd: '25.00' }]
    }
  };

  const validHeaders = {
    'Content-Type': 'application/json',
    'X-RFQ-ID': 'test-rfq-123'
  };

  beforeEach(() => {
    jest.resetAllMocks();
    app = createApp();

    mockPage = {
      goto: jest.fn().mockResolvedValue({ status: () => 200 }),
      waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined)
    };
    mockBrowser = { close: jest.fn().mockResolvedValue(undefined) };

    mockGetShuttingDown.mockReturnValue(false);
    mockIsConfigured.mockReturnValue(true);
    mockGenerateIdempotencyKey.mockReturnValue('test-key');
    mockLaunchBrowser.mockResolvedValue(mockBrowser);
    mockSetupPage.mockResolvedValue(mockPage);
    mockCloseBrowser.mockResolvedValue(undefined);
    mockFillRfqForm.mockResolvedValue(undefined);
    mockCancelFormSubmission.mockResolvedValue(undefined);
    mockSubmitForm.mockResolvedValue(true);
    mockDelay.mockResolvedValue(undefined);
    mockCheckIdempotency.mockReturnValue(null);
    mockStartProcessing.mockReturnValue(true);
    mockCaptureAndUploadScreenshot.mockResolvedValue({
      url: 'https://test.supabase.co/screenshot.png',
      type: 'filled',
      captured_at: new Date().toISOString(),
      storage_path: 'screenshots/test.png'
    });
  });

  describe('middleware', () => {
    it('should assign X-Request-ID from header', async () => {
      const response = await request(app)
        .post('/fill-rfq')
        .set({ ...validHeaders, 'X-Request-ID': 'custom-id' })
        .send(validPayload)
        .expect(200);

      expect(response.headers['x-request-id']).toBe('custom-id');
      expect(response.body.requestId).toBe('custom-id');
    });

    it('should generate X-Request-ID when not provided', async () => {
      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should return 503 when shutting down', async () => {
      mockGetShuttingDown.mockReturnValue(true);

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(503);

      expect(response.body.error).toContain('shutting down');
    });
  });

  describe('validation', () => {
    it('should return 503 when Supabase is not configured', async () => {
      mockIsConfigured.mockReturnValue(false);

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(503);

      expect(response.body.error).toContain('Supabase not configured');
    });

    it('should return 400 when X-RFQ-ID header is missing', async () => {
      const response = await request(app)
        .post('/fill-rfq')
        .send(validPayload)
        .expect(400);

      expect(response.body.error).toContain('X-RFQ-ID');
    });

    it('should return 400 for invalid request body', async () => {
      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send({})
        .expect(400);

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('idempotency', () => {
    it('should reject duplicate processing request with 409', async () => {
      mockCheckIdempotency.mockReturnValue({ status: 'processing' });

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(409);

      expect(response.body.error).toContain('already being processed');
    });

    it('should return cached result for completed production request', async () => {
      mockCheckIdempotency.mockReturnValue({
        status: 'completed',
        result: { success: true, finalAction: 'FORM_SUBMITTED' }
      });

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send({ ...validPayload, isTestMode: false })
        .expect(200);

      expect(response.body.cached).toBe(true);
    });

    it('should allow retry for failed requests', async () => {
      mockCheckIdempotency.mockReturnValue({ status: 'failed' });

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(200);

      expect(mockRemoveKey).toHaveBeenCalled();
      expect(response.body.success).toBe(true);
    });

    it('should allow retry for test mode completed requests', async () => {
      mockCheckIdempotency.mockReturnValue({
        status: 'completed',
        result: { success: true }
      });

      const _response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send({ ...validPayload, isTestMode: true })
        .expect(200);

      expect(mockRemoveKey).toHaveBeenCalled();
    });

    it('should return 409 on race condition', async () => {
      mockStartProcessing.mockReturnValue(false);

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(409);

      expect(response.body.error).toContain('Concurrent request');
    });
  });

  describe('successful form fill - test mode', () => {
    it('should fill form and cancel in test mode', async () => {
      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.finalAction).toBe('FORM_CANCELLED');
      expect(response.body.isTestMode).toBe(true);
      expect(mockCancelFormSubmission).toHaveBeenCalled();
      expect(mockSubmitForm).not.toHaveBeenCalled();
      expect(mockMarkCompleted).toHaveBeenCalled();
    });

    it('should include screenshot data', async () => {
      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(200);

      expect(response.body.screenshot_data).toHaveLength(1);
      expect(response.body.screenshot_data[0].form_url).toBe('https://example.com/rfq-form');
    });
  });

  describe('successful form fill - production mode', () => {
    it('should fill form and submit in production mode', async () => {
      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send({ ...validPayload, isTestMode: false })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.finalAction).toBe('FORM_SUBMITTED');
      expect(response.body.isTestMode).toBe(false);
      expect(mockSubmitForm).toHaveBeenCalled();
      expect(mockCancelFormSubmission).not.toHaveBeenCalled();
    });

    it('should return 500 when submit fails in production', async () => {
      mockSubmitForm.mockResolvedValue(false);

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send({ ...validPayload, isTestMode: false })
        .expect(500);

      expect(response.body.finalAction).toBe('FORM_SUBMISSION_FAILED');
      expect(mockMarkFailed).toHaveBeenCalled();
    });
  });

  describe('navigation', () => {
    it('should retry navigation on failure', async () => {
      mockPage.goto
        .mockRejectedValueOnce(new Error('Nav failed'))
        .mockRejectedValueOnce(new Error('Nav failed'))
        .mockResolvedValueOnce({ status: () => 200 });

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockSetupPage).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should fail after 3 navigation attempts', async () => {
      mockPage.goto.mockRejectedValue(new Error('Nav failed'));

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(500);

      expect(response.body.error).toContain('Failed to navigate after 3 attempts');
      expect(mockMarkFailed).toHaveBeenCalled();
    });

    it('should handle network idle timeout gracefully', async () => {
      mockPage.waitForNetworkIdle.mockRejectedValue(new Error('Timeout'));

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should handle null navigation response', async () => {
      mockPage.goto.mockResolvedValue(null);

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('conditionCode integration', () => {
    it('should pass items with conditionCode to fillRfqForm', async () => {
      const payload = {
        rfq_details: { quote_submission_url: 'https://example.com/rfq-form' },
        quote_details: {
          items: [
            { conditionCode: 'NE', qty_available: '10', price_usd: '25.00' },
            { conditionCode: 'SV', qty_available: '5', price_usd: '900.00' }
          ]
        }
      };

      await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(payload)
        .expect(200);

      expect(mockFillRfqForm).toHaveBeenCalledWith(
        expect.anything(),
        payload.quote_details,
        expect.any(String)
      );
    });

    it('should accept items without conditionCode (defaults to NE)', async () => {
      await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(200);

      expect(mockFillRfqForm).toHaveBeenCalled();
    });

    it('should return 400 for invalid conditionCode in items', async () => {
      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send({
          rfq_details: { quote_submission_url: 'https://example.com/rfq-form' },
          quote_details: {
            items: [{ conditionCode: 'XX', qty_available: '10' }]
          }
        })
        .expect(400);

      expect(response.body.errors[0]).toContain('must be one of');
    });

    it('should accept all valid condition codes in items', async () => {
      const payload = {
        rfq_details: { quote_submission_url: 'https://example.com/rfq-form' },
        quote_details: {
          items: [
            { conditionCode: 'NE', qty_available: '1' },
            { conditionCode: 'NS', qty_available: '2' },
            { conditionCode: 'OH', qty_available: '3' },
            { conditionCode: 'SV', qty_available: '4' },
            { conditionCode: 'AR', qty_available: '5' }
          ]
        }
      };

      await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(payload)
        .expect(200);

      expect(mockFillRfqForm).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return 500 when browser launch fails', async () => {
      mockLaunchBrowser.mockRejectedValue(new Error('Launch failed'));

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(500);

      expect(response.body.error).toBe('Launch failed');
      expect(mockMarkFailed).toHaveBeenCalled();
    });

    it('should return 500 when form fill fails', async () => {
      mockFillRfqForm.mockRejectedValue(new Error('Fill failed'));

      const response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(500);

      expect(response.body.error).toBe('Fill failed');
    });

    it('should close browser in finally block', async () => {
      mockFillRfqForm.mockRejectedValue(new Error('Fill failed'));

      await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(500);

      expect(mockCloseBrowser).toHaveBeenCalledWith(mockBrowser, expect.any(String));
    });

    it('should not close browser when keepOpen is true', async () => {
      const _response = await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send({ ...validPayload, keepOpen: true })
        .expect(200);

      expect(mockCloseBrowser).not.toHaveBeenCalled();
    });

    it('should not close browser when browser is null (launch failed)', async () => {
      mockLaunchBrowser.mockRejectedValue(new Error('Launch failed'));

      await request(app)
        .post('/fill-rfq')
        .set(validHeaders)
        .send(validPayload)
        .expect(500);

      expect(mockCloseBrowser).not.toHaveBeenCalled();
    });
  });
});
