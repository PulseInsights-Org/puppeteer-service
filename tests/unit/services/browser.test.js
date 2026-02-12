/**
 * Unit tests for browser service
 */

jest.mock('puppeteer');

describe('Browser Service', () => {
  let browserService;
  let puppeteer;
  let mockBrowser;
  let mockPage;

  beforeEach(() => {
    jest.resetModules();

    mockPage = {
      setViewport: jest.fn().mockResolvedValue(undefined),
      setUserAgent: jest.fn().mockResolvedValue(undefined),
      setExtraHTTPHeaders: jest.fn().mockResolvedValue(undefined),
      setDefaultTimeout: jest.fn(),
      setDefaultNavigationTimeout: jest.fn(),
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined)
    };

    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn()
    };

    puppeteer = require('puppeteer');
    puppeteer.launch.mockResolvedValue(mockBrowser);
    browserService = require('../../../src/services/browser');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('launchBrowser', () => {
    it('should launch browser with puppeteer', async () => {
      const browser = await browserService.launchBrowser('test-request-id');
      expect(puppeteer.launch).toHaveBeenCalled();
      expect(browser).toBe(mockBrowser);
    });

    it('should configure browser with required args', async () => {
      await browserService.launchBrowser('test-request-id');

      const launchCall = puppeteer.launch.mock.calls[0][0];
      expect(launchCall.args).toContain('--no-sandbox');
      expect(launchCall.args).toContain('--disable-setuid-sandbox');
      expect(launchCall.args).toContain('--disable-dev-shm-usage');
    });

    it('should set viewport dimensions', async () => {
      await browserService.launchBrowser('test-request-id');

      const launchCall = puppeteer.launch.mock.calls[0][0];
      expect(launchCall.defaultViewport).toEqual({ width: 1920, height: 1080 });
    });

    it('should set protocol timeout', async () => {
      await browserService.launchBrowser('test-request-id');

      const launchCall = puppeteer.launch.mock.calls[0][0];
      expect(launchCall.protocolTimeout).toBe(300000);
    });

    it('should register disconnected event handler', async () => {
      await browserService.launchBrowser('test-request-id');
      expect(mockBrowser.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
    });

    it('should remove browser from active set on disconnect', async () => {
      await browserService.launchBrowser('test-request-id');
      const disconnectHandler = mockBrowser.on.mock.calls.find(c => c[0] === 'disconnected')[1];
      disconnectHandler();
      // After disconnect, closeAllBrowsers should have nothing to close
      mockBrowser.close.mockClear();
      await browserService.closeAllBrowsers();
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });
  });

  describe('setupPage', () => {
    it('should create new page from browser', async () => {
      const browser = await browserService.launchBrowser('test-request-id');
      const page = await browserService.setupPage(browser, 'test-request-id');

      expect(browser.newPage).toHaveBeenCalled();
      expect(page).toBe(mockPage);
    });

    it('should set viewport on page', async () => {
      const browser = await browserService.launchBrowser('test-request-id');
      await browserService.setupPage(browser, 'test-request-id');

      expect(mockPage.setViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    });

    it('should set user agent', async () => {
      const browser = await browserService.launchBrowser('test-request-id');
      await browserService.setupPage(browser, 'test-request-id');

      expect(mockPage.setUserAgent).toHaveBeenCalledWith(
        expect.stringContaining('Mozilla/5.0')
      );
    });

    it('should set extra HTTP headers', async () => {
      const browser = await browserService.launchBrowser('test-request-id');
      await browserService.setupPage(browser, 'test-request-id');

      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': expect.any(String)
      });
    });

    it('should set default timeouts', async () => {
      const browser = await browserService.launchBrowser('test-request-id');
      await browserService.setupPage(browser, 'test-request-id');

      expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(120000);
      expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(120000);
    });

    it('should register request failed handler', async () => {
      const browser = await browserService.launchBrowser('test-request-id');
      await browserService.setupPage(browser, 'test-request-id');

      expect(mockPage.on).toHaveBeenCalledWith('requestfailed', expect.any(Function));
    });
  });

  describe('closeBrowser', () => {
    it('should close browser', async () => {
      const browser = await browserService.launchBrowser('test-request-id');
      await browserService.closeBrowser(browser, 'test-request-id');

      expect(browser.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      mockBrowser.close.mockRejectedValueOnce(new Error('Close failed'));

      const browser = await browserService.launchBrowser('test-request-id');
      await expect(browserService.closeBrowser(browser, 'test-request-id')).resolves.toBeUndefined();
    });
  });

  describe('closeAllBrowsers', () => {
    it('should close all active browsers', async () => {
      await browserService.launchBrowser('test-request-1');

      await browserService.closeAllBrowsers();

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('should handle errors when closing browsers', async () => {
      await browserService.launchBrowser('test-request-1');
      mockBrowser.close.mockRejectedValueOnce(new Error('Close failed'));

      await expect(browserService.closeAllBrowsers()).resolves.toBeUndefined();
    });
  });

  describe('shutdown state management', () => {
    it('should track shutting down state', () => {
      const initialState = browserService.getShuttingDown();
      expect(typeof initialState).toBe('boolean');
    });

    it('should set shutting down state', () => {
      browserService.setShuttingDown(true);
      expect(browserService.getShuttingDown()).toBe(true);
    });

    it('should reset shutting down state', () => {
      browserService.setShuttingDown(true);
      browserService.setShuttingDown(false);
      expect(browserService.getShuttingDown()).toBe(false);
    });
  });

  describe('constants', () => {
    it('should export DEFAULT_TIMEOUT', () => {
      expect(browserService.DEFAULT_TIMEOUT).toBe(120000);
    });

    it('should export VIEWPORT dimensions', () => {
      expect(browserService.VIEWPORT).toEqual({ width: 1920, height: 1080 });
    });
  });
});
