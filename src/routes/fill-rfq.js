/**
 * Puppeteer Service - Fill RFQ Route
 * POST /puppeteer/fill-rfq
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const logger = require('../utils/logger');
const { validateRfqRequest } = require('../utils/validation');
const { rateLimit } = require('../middleware/rate-limiter');
const { launchBrowser, setupPage, closeBrowser, getShuttingDown } = require('../services/browser');
const { fillRfqForm, cancelFormSubmission, submitForm, delay } = require('../services/form-filler');
const { captureAndUploadScreenshot, isConfigured: isSupabaseConfigured } = require('../services/screenshot');
const {
  generateIdempotencyKey,
  checkIdempotency,
  startProcessing,
  markCompleted,
  markFailed,
  removeKey
} = require('../services/idempotency');

// Apply rate limiting to this route
router.use(rateLimit());

// Request ID middleware
router.use((req, res, next) => {
  req.puppeteerId = req.get('X-Request-ID') || crypto.randomUUID();
  res.set('X-Request-ID', req.puppeteerId);
  next();
});

// Request logging
router.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    logger.info('Request completed', {
      requestId: req.puppeteerId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: Date.now() - start
    });
  });

  next();
});

// Shutdown check
router.use((req, res, next) => {
  if (getShuttingDown()) {
    return res.status(503).json({
      success: false,
      error: 'Puppeteer service is shutting down'
    });
  }
  next();
});

/**
 * @swagger
 * /puppeteer/fill-rfq:
 *   post:
 *     summary: Fill RFQ form using browser automation
 *     tags: [Puppeteer]
 *     parameters:
 *       - in: header
 *         name: X-RFQ-ID
 *         schema:
 *           type: string
 *         description: RFQ ID for tracking and screenshot organization
 *       - in: header
 *         name: X-Request-ID
 *         schema:
 *           type: string
 *         description: Request ID for tracking
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - rfq_details
 *               - quote_details
 *             properties:
 *               rfq_details:
 *                 type: object
 *                 required:
 *                   - quote_submission_url
 *                 properties:
 *                   quote_submission_url:
 *                     type: string
 *                     description: URL to the RFQ form
 *               quote_details:
 *                 type: object
 *                 properties:
 *                   items:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         part_no:
 *                           type: string
 *                         qty_available:
 *                           type: string
 *                         traceability:
 *                           type: string
 *                         uom:
 *                           type: string
 *                         price_usd:
 *                           type: string
 *                         price_type:
 *                           type: string
 *                           enum: [OUTRIGHT, EXCHANGE]
 *                         lead_time:
 *                           type: string
 *                         tag_date:
 *                           type: string
 *                         min_qty:
 *                           type: number
 *                         comments:
 *                           type: string
 *                         no_quote:
 *                           type: boolean
 *                   supplier_comments:
 *                     type: string
 *                   quote_prepared_by:
 *                     type: string
 *               keepOpen:
 *                 type: boolean
 *                 default: false
 *                 description: Keep browser open after filling (dev only)
 *     responses:
 *       200:
 *         description: Form filled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 requestId:
 *                   type: string
 *                 screenshots:
 *                   type: object
 *                 screenshot_data:
 *                   type: array
 *       400:
 *         description: Validation error
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const requestId = req.puppeteerId;
  const { rfq_details, quote_details, keepOpen = false, isTestMode = true } = req.body;
  const rfqId = req.header('X-RFQ-ID');

  // Log execution mode (Single Source of Truth: isTestMode flag from RFQ Ingest Service)
  logger.info('Execution mode received', {
    requestId,
    rfqId,
    isTestMode,
    mode: isTestMode ? 'TEST_MODE' : 'PRODUCTION_MODE'
  });

  // Check Supabase configuration (required)
  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.',
      requestId
    });
  }

  // Require X-RFQ-ID header for screenshot organization
  if (!rfqId) {
    return res.status(400).json({
      success: false,
      error: 'X-RFQ-ID header is required for screenshot uploads',
      requestId
    });
  }

  // Validate request
  const validationErrors = validateRfqRequest(req.body);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      errors: validationErrors,
      requestId
    });
  }

  const url = rfq_details.quote_submission_url;

  // IDEMPOTENCY CHECK: Prevent duplicate form submissions in production mode
  const idempotencyKey = generateIdempotencyKey(rfqId, url, isTestMode);

  // Check for existing processing or completed request
  const existingRecord = checkIdempotency(idempotencyKey);
  if (existingRecord) {
    if (existingRecord.status === 'processing') {
      logger.warn('Duplicate request rejected - already processing', {
        requestId,
        rfqId,
        isTestMode,
        idempotencyKey
      });
      return res.status(409).json({
        success: false,
        error: 'Request already being processed. Please wait for completion.',
        requestId,
        idempotencyKey,
        existingStatus: 'processing'
      });
    }

    if (existingRecord.status === 'completed' && !isTestMode) {
      // In production mode, return cached result to prevent duplicate submissions
      logger.warn('Duplicate production submission prevented - returning cached result', {
        requestId,
        rfqId,
        idempotencyKey
      });
      return res.status(200).json({
        ...existingRecord.result,
        cached: true,
        message: 'Form was already submitted successfully. Returning cached result.',
        requestId
      });
    }

    // For test mode or failed requests, allow retry (remove old key)
    if (existingRecord.status === 'failed' || isTestMode) {
      logger.info('Allowing retry for previous failed/test request', {
        requestId,
        rfqId,
        previousStatus: existingRecord.status,
        isTestMode
      });
      removeKey(idempotencyKey);
    }
  }

  // Mark request as processing
  if (!startProcessing(idempotencyKey)) {
    // Race condition - another request started between check and start
    return res.status(409).json({
      success: false,
      error: 'Concurrent request detected. Please retry.',
      requestId
    });
  }

  let browser = null;

  try {
    logger.info('Starting form fill', { requestId, url, rfqId });

    browser = await launchBrowser(requestId);
    let page = await setupPage(browser, requestId);

    logger.info('Navigating to URL', { requestId });
    let navigationSuccess = false;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await page.goto(url, {
          waitUntil: 'load',
          timeout: 120000
        });

        if (response) {
          logger.info('Navigation response', { requestId, status: response.status() });
        }

        await page.waitForNetworkIdle({ timeout: 60000 }).catch(() => {
          logger.warn('Network idle timeout, continuing', { requestId });
        });

        navigationSuccess = true;
        break;
      } catch (navError) {
        lastError = navError;
        logger.warn(`Navigation attempt ${attempt} failed`, { requestId, error: navError.message });
        if (attempt < 3) {
          await page.close().catch(() => {});
          page = await setupPage(browser, requestId);
          await delay(3000);
        }
      }
    }

    if (!navigationSuccess) {
      throw new Error(`Failed to navigate after 3 attempts: ${lastError?.message}`);
    }

    await delay(2000);
    logger.info('Page loaded successfully', { requestId });

    logger.info('Starting form fill', { requestId });
    await fillRfqForm(page, quote_details, requestId);

    // Capture and upload screenshot directly to Supabase
    logger.info('Capturing and uploading screenshot to Supabase', { requestId, rfqId });
    const screenshotResult = await captureAndUploadScreenshot(page, rfqId, 'filled', requestId);
    screenshotResult.form_url = url;

    logger.info('Screenshot upload complete', { requestId, url: screenshotResult.url });

    // Conditional form action based on isTestMode flag from RFQ Ingest Service
    // isTestMode = true  → Cancel form (test mode, no downstream side effects)
    // isTestMode = false → Submit form (production mode)
    let finalAction;
    let submitSuccess = true;

    if (isTestMode) {
      await cancelFormSubmission(page, requestId);
      finalAction = 'FORM_CANCELLED';
      logger.info('Final action: FORM_CANCELLED (test mode)', { requestId, rfqId });
    } else {
      submitSuccess = await submitForm(page, requestId);
      finalAction = submitSuccess ? 'FORM_SUBMITTED' : 'FORM_SUBMISSION_FAILED';
      logger.info(`Final action: ${finalAction} (production mode)`, { requestId, rfqId, submitSuccess });
    }

    // If production mode submission failed, return error
    if (!isTestMode && !submitSuccess) {
      // Mark as failed in idempotency store (allows retry)
      markFailed(idempotencyKey, 'Form submission failed - submit button not found or submission error');

      return res.status(500).json({
        success: false,
        error: 'Form submission failed - submit button not found or submission error',
        requestId,
        finalAction,
        screenshot_data: [screenshotResult]
      });
    }

    // Build success response
    const successResponse = {
      success: true,
      message: isTestMode ? 'Form filled and cancelled successfully' : 'Form filled and submitted successfully',
      requestId,
      finalAction,
      isTestMode,
      screenshot_data: [screenshotResult]
    };

    // Mark as completed in idempotency store
    markCompleted(idempotencyKey, successResponse);

    res.json(successResponse);

  } catch (error) {
    logger.error('Form fill failed', { requestId, error: error.message, stack: error.stack });

    // Mark as failed in idempotency store (allows retry)
    markFailed(idempotencyKey, error.message || 'An unexpected error occurred');

    res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred',
      requestId
    });

  } finally {
    if (browser && !keepOpen) {
      await closeBrowser(browser, requestId);
    } else if (keepOpen) {
      logger.info('Browser kept open for inspection', { requestId });
    }
  }
});

module.exports = router;
