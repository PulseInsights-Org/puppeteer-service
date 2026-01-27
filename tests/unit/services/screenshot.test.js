/**
 * Unit tests for screenshot service
 */

describe('Screenshot Service', () => {
  let screenshotService;
  let mockPage;
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();

    // Set up environment for tests
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://test-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key'
    };

    mockPage = {
      evaluate: jest.fn().mockResolvedValue(undefined),
      screenshot: jest.fn().mockResolvedValue(Buffer.from('fake-screenshot-data'))
    };

    // Mock global fetch
    global.fetch = jest.fn();

    screenshotService = require('../../../src/services/screenshot');
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('isConfigured', () => {
    it('should return true when Supabase credentials are set', () => {
      expect(screenshotService.isConfigured()).toBe(true);
    });

    it('should return false when SUPABASE_URL is missing', () => {
      jest.resetModules();
      process.env = {
        ...originalEnv,
        NODE_ENV: 'test',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key'
      };

      const service = require('../../../src/services/screenshot');
      expect(service.isConfigured()).toBe(false);
    });

    it('should return false when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
      jest.resetModules();
      process.env = {
        ...originalEnv,
        NODE_ENV: 'test',
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: ''
      };

      const service = require('../../../src/services/screenshot');
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('uploadScreenshotToSupabase', () => {
    const testBuffer = Buffer.from('test-image-data');
    const rfqId = 'test-rfq-123';
    const screenshotType = 'filled';
    const requestId = 'test-request-456';

    it('should upload screenshot successfully', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200
      });

      const result = await screenshotService.uploadScreenshotToSupabase(
        rfqId,
        testBuffer,
        screenshotType,
        requestId
      );

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('type', screenshotType);
      expect(result).toHaveProperty('captured_at');
      expect(result).toHaveProperty('storage_path');
    });

    it('should call fetch with correct URL', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });

      await screenshotService.uploadScreenshotToSupabase(
        rfqId,
        testBuffer,
        screenshotType,
        requestId
      );

      const fetchCall = global.fetch.mock.calls[0];
      expect(fetchCall[0]).toContain('supabase.co');
      expect(fetchCall[0]).toContain('storage/v1/object');
      expect(fetchCall[0]).toContain('rfq-artifacts');
      expect(fetchCall[0]).toContain(rfqId);
    });

    it('should include correct headers', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });

      await screenshotService.uploadScreenshotToSupabase(
        rfqId,
        testBuffer,
        screenshotType,
        requestId
      );

      const fetchCall = global.fetch.mock.calls[0];
      const options = fetchCall[1];

      expect(options.headers).toHaveProperty('apikey', 'test-service-role-key');
      expect(options.headers).toHaveProperty('Authorization', 'Bearer test-service-role-key');
      expect(options.headers).toHaveProperty('Content-Type', 'image/png');
      expect(options.headers).toHaveProperty('x-upsert', 'true');
    });

    it('should use POST method', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });

      await screenshotService.uploadScreenshotToSupabase(
        rfqId,
        testBuffer,
        screenshotType,
        requestId
      );

      const fetchCall = global.fetch.mock.calls[0];
      expect(fetchCall[1].method).toBe('POST');
    });

    it('should send buffer as body', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });

      await screenshotService.uploadScreenshotToSupabase(
        rfqId,
        testBuffer,
        screenshotType,
        requestId
      );

      const fetchCall = global.fetch.mock.calls[0];
      expect(fetchCall[1].body).toBe(testBuffer);
    });

    it('should throw error when upload fails', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Internal Server Error')
      });

      await expect(
        screenshotService.uploadScreenshotToSupabase(rfqId, testBuffer, screenshotType, requestId)
      ).rejects.toThrow('Supabase upload failed');
    });

    it('should throw error when Supabase not configured', async () => {
      jest.resetModules();
      process.env = {
        ...originalEnv,
        NODE_ENV: 'test',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: ''
      };

      const service = require('../../../src/services/screenshot');

      await expect(
        service.uploadScreenshotToSupabase(rfqId, testBuffer, screenshotType, requestId)
      ).rejects.toThrow('Supabase credentials not configured');
    });

    it('should return correct public URL format', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await screenshotService.uploadScreenshotToSupabase(
        rfqId,
        testBuffer,
        screenshotType,
        requestId
      );

      expect(result.url).toContain('public');
      expect(result.url).toContain('rfq-artifacts');
      expect(result.url).toContain(rfqId);
    });

    it('should include timestamp in storage path', async () => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });

      const result = await screenshotService.uploadScreenshotToSupabase(
        rfqId,
        testBuffer,
        screenshotType,
        requestId
      );

      expect(result.storage_path).toMatch(/screenshots\/.*\/rfq-filled-\d+\.png/);
    });

    it('should handle network errors', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'));

      await expect(
        screenshotService.uploadScreenshotToSupabase(rfqId, testBuffer, screenshotType, requestId)
      ).rejects.toThrow('Network error');
    });
  });

  describe('captureAndUploadScreenshot', () => {
    const rfqId = 'test-rfq-123';
    const screenshotType = 'filled';
    const requestId = 'test-request-456';

    beforeEach(() => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });
    });

    it('should scroll page to top before capturing', async () => {
      await screenshotService.captureAndUploadScreenshot(
        mockPage,
        rfqId,
        screenshotType,
        requestId
      );

      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should capture full page screenshot', async () => {
      await screenshotService.captureAndUploadScreenshot(
        mockPage,
        rfqId,
        screenshotType,
        requestId
      );

      expect(mockPage.screenshot).toHaveBeenCalledWith({
        fullPage: true,
        captureBeyondViewport: true,
        type: 'png'
      });
    });

    it('should upload captured screenshot to Supabase', async () => {
      await screenshotService.captureAndUploadScreenshot(
        mockPage,
        rfqId,
        screenshotType,
        requestId
      );

      expect(global.fetch).toHaveBeenCalled();
    });

    it('should return upload result', async () => {
      const result = await screenshotService.captureAndUploadScreenshot(
        mockPage,
        rfqId,
        screenshotType,
        requestId
      );

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('type', screenshotType);
      expect(result).toHaveProperty('captured_at');
      expect(result).toHaveProperty('storage_path');
    });

    it('should throw error when screenshot capture fails', async () => {
      mockPage.screenshot.mockRejectedValue(new Error('Screenshot failed'));

      await expect(
        screenshotService.captureAndUploadScreenshot(mockPage, rfqId, screenshotType, requestId)
      ).rejects.toThrow('Screenshot failed');
    });

    it('should throw error when Supabase not configured', async () => {
      jest.resetModules();
      process.env = {
        ...originalEnv,
        NODE_ENV: 'test',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: ''
      };

      const service = require('../../../src/services/screenshot');

      await expect(
        service.captureAndUploadScreenshot(mockPage, rfqId, screenshotType, requestId)
      ).rejects.toThrow('Supabase credentials not configured');
    });
  });

  describe('screenshot types', () => {
    beforeEach(() => {
      global.fetch.mockResolvedValue({ ok: true, status: 200 });
    });

    it('should handle "filled" screenshot type', async () => {
      const result = await screenshotService.captureAndUploadScreenshot(
        mockPage,
        'rfq-123',
        'filled',
        'request-456'
      );

      expect(result.type).toBe('filled');
      expect(result.storage_path).toContain('rfq-filled');
    });

    it('should handle "before" screenshot type', async () => {
      const result = await screenshotService.captureAndUploadScreenshot(
        mockPage,
        'rfq-123',
        'before',
        'request-456'
      );

      expect(result.type).toBe('before');
      expect(result.storage_path).toContain('rfq-before');
    });

    it('should handle "after" screenshot type', async () => {
      const result = await screenshotService.captureAndUploadScreenshot(
        mockPage,
        'rfq-123',
        'after',
        'request-456'
      );

      expect(result.type).toBe('after');
      expect(result.storage_path).toContain('rfq-after');
    });
  });

  describe('module exports', () => {
    it('should export isConfigured function', () => {
      expect(typeof screenshotService.isConfigured).toBe('function');
    });

    it('should export uploadScreenshotToSupabase function', () => {
      expect(typeof screenshotService.uploadScreenshotToSupabase).toBe('function');
    });

    it('should export captureAndUploadScreenshot function', () => {
      expect(typeof screenshotService.captureAndUploadScreenshot).toBe('function');
    });
  });
});
