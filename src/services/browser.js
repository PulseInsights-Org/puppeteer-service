/**
 * Puppeteer Service - Browser Automation
 * Handles browser lifecycle management
 */

const puppeteer = require('puppeteer');
const logger = require('../utils/logger');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CHROME_PATH = process.env.CHROME_PATH ||
  (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const HEADLESS = IS_PRODUCTION;
const DEFAULT_TIMEOUT = 60000;
const VIEWPORT = { width: 1920, height: 1080 };

// Track active browsers for graceful shutdown
const activeBrowsers = new Set();
let isShuttingDown = false;

async function launchBrowser(requestId) {
  const launchOptions = {
    headless: HEADLESS ? 'new' : false,
    defaultViewport: VIEWPORT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`
    ],
    protocolTimeout: 120000
  };

  // Only add security-relaxing flags in development
  if (!IS_PRODUCTION) {
    launchOptions.args.push(
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    );
  }

  if (CHROME_PATH) {
    launchOptions.executablePath = CHROME_PATH;
  }

  logger.info('Launching browser', { requestId, headless: HEADLESS });
  const browser = await puppeteer.launch(launchOptions);
  activeBrowsers.add(browser);

  browser.on('disconnected', () => {
    activeBrowsers.delete(browser);
    logger.warn('Browser disconnected', { requestId });
  });

  return browser;
}

async function setupPage(browser, requestId) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  });

  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);

  page.on('requestfailed', (request) => {
    logger.debug('Request failed', {
      requestId,
      url: request.url(),
      error: request.failure()?.errorText
    });
  });

  return page;
}

async function closeBrowser(browser, requestId) {
  try {
    activeBrowsers.delete(browser);
    await browser.close();
    logger.info('Browser closed', { requestId });
  } catch (error) {
    logger.warn('Error closing browser', { requestId, error: error.message });
  }
}

async function closeAllBrowsers() {
  const browserClosePromises = Array.from(activeBrowsers).map(async (browser) => {
    try {
      await browser.close();
    } catch (error) {
      logger.warn('Error closing browser during shutdown', { error: error.message });
    }
  });

  await Promise.all(browserClosePromises);
  logger.info('All puppeteer browsers closed');
}

function setShuttingDown(value) {
  isShuttingDown = value;
}

function getShuttingDown() {
  return isShuttingDown;
}

module.exports = {
  launchBrowser,
  setupPage,
  closeBrowser,
  closeAllBrowsers,
  setShuttingDown,
  getShuttingDown,
  DEFAULT_TIMEOUT,
  VIEWPORT
};
