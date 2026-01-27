/**
 * Puppeteer Service - Screenshot Management
 * Handles screenshot capture and direct upload to Supabase
 *
 * REQUIRED: Supabase credentials must be configured in environment variables
 */

const logger = require('../utils/logger');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = 'rfq-artifacts';

// Validate Supabase credentials on module load
function validateSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logger.error('MISSING REQUIRED CONFIG: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    return false;
  }
  logger.info('Supabase configuration validated successfully');
  return true;
}

const isSupabaseConfigured = validateSupabaseConfig();

/**
 * Check if Supabase is properly configured
 * @returns {boolean}
 */
function isConfigured() {
  return isSupabaseConfigured;
}

/**
 * Upload screenshot buffer directly to Supabase storage
 * @param {string} rfqId - RFQ identifier for organizing screenshots
 * @param {Buffer} screenshotBuffer - Screenshot image buffer
 * @param {string} screenshotType - Type of screenshot (e.g., 'filled', 'before', 'after')
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<Object|null>} Upload result with URL or null on failure
 */
async function uploadScreenshotToSupabase(rfqId, screenshotBuffer, screenshotType, requestId) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  const fileName = `rfq-${screenshotType}-${Date.now()}.png`;
  const storagePath = `screenshots/${rfqId}/${fileName}`;
  const uploadUrl = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`;

  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true'
      },
      body: screenshotBuffer
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Screenshot upload failed', { requestId, status: response.status, error: errorText });
      throw new Error(`Supabase upload failed: ${response.status} - ${errorText}`);
    }

    const publicUrl = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;
    logger.info('Screenshot uploaded to Supabase', { requestId, url: publicUrl });

    return {
      url: publicUrl,
      type: screenshotType,
      captured_at: new Date().toISOString(),
      storage_path: storagePath
    };
  } catch (error) {
    logger.error('Screenshot upload error', { requestId, error: error.message });
    throw error;
  }
}

/**
 * Capture screenshot from page and upload directly to Supabase
 * @param {Object} page - Puppeteer page object
 * @param {string} rfqId - RFQ identifier
 * @param {string} screenshotType - Type of screenshot
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<Object>} Upload result with URL
 */
async function captureAndUploadScreenshot(page, rfqId, screenshotType, requestId) {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase credentials not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  }

  // Scroll to top before capturing
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 500));

  // Capture screenshot as buffer (no local file)
  const screenshotBuffer = await page.screenshot({
    fullPage: true,
    captureBeyondViewport: true,
    type: 'png'
  });

  logger.info('Screenshot captured', { requestId, type: screenshotType });

  // Upload directly to Supabase
  return await uploadScreenshotToSupabase(rfqId, screenshotBuffer, screenshotType, requestId);
}

module.exports = {
  isConfigured,
  uploadScreenshotToSupabase,
  captureAndUploadScreenshot
};
