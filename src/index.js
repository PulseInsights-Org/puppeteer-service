/**
 * Puppeteer Service - Main Router
 *
 * This module provides isolated browser automation endpoints
 * for RFQ form filling. It is completely separate from the
 * Shopify Doc Portal functionality.
 *
 * Mount point: /puppeteer
 *
 * Endpoints:
 *   GET  /puppeteer/health       - Health check
 *   GET  /puppeteer/ready        - Readiness probe
 *   POST /puppeteer/fill-rfq     - Fill RFQ form
 */

const express = require('express');
const router = express.Router();

const logger = require('./utils/logger');
const { closeAllBrowsers, setShuttingDown, getShuttingDown } = require('./services/browser');

// =============================================================================
// HEALTH CHECK ENDPOINTS
// =============================================================================

/**
 * @swagger
 * /puppeteer/health:
 *   get:
 *     summary: Puppeteer service health check
 *     tags: [Puppeteer]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 service:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *                 uptime:
 *                   type: number
 *                 environment:
 *                   type: string
 *                 memory:
 *                   type: object
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'puppeteer',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime(),
    environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      unit: 'MB'
    }
  });
});

/**
 * @swagger
 * /puppeteer/ready:
 *   get:
 *     summary: Puppeteer service readiness probe
 *     tags: [Puppeteer]
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is shutting down
 */
router.get('/ready', (req, res) => {
  if (getShuttingDown()) {
    return res.status(503).json({ ready: false, reason: 'shutting_down' });
  }
  res.json({ ready: true });
});

// =============================================================================
// API ROUTES
// =============================================================================

router.use('/fill-rfq', require('./routes/fill-rfq'));

// =============================================================================
// ERROR HANDLING (Puppeteer-specific)
// =============================================================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Puppeteer endpoint not found',
    path: req.path
  });
});

router.use((err, req, res, _next) => {
  logger.error('Puppeteer unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// =============================================================================
// GRACEFUL SHUTDOWN HANDLER
// =============================================================================

async function gracefulShutdown() {
  if (getShuttingDown()) return;

  setShuttingDown(true);
  logger.info('Puppeteer service shutting down');

  await closeAllBrowsers();
}

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

logger.info('Puppeteer service initialized');

module.exports = router;
