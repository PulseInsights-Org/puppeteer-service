/**
 * Puppeteer Service - Standalone Server
 *
 * A lightweight Express server for the Puppeteer RFQ form automation service.
 * Designed for deployment on EC2 T2 nano or similar small instances.
 */

require('dotenv').config();

const express = require('express');
const puppeteerRouter = require('./src/index');
const logger = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Parse JSON request bodies
app.use(express.json({ limit: '10mb' }));

// CORS - Allow all origins (configure as needed for production)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-RFQ-ID, X-Request-ID');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: Date.now() - start
    });
  });
  next();
});

// =============================================================================
// ROUTES
// =============================================================================

// Root health check
app.get('/', (req, res) => {
  res.json({
    service: 'puppeteer-service',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: '/puppeteer/health',
      ready: '/puppeteer/ready',
      fillRfq: 'POST /puppeteer/api/fill-rfq'
    }
  });
});

// Mount puppeteer service at /puppeteer
app.use('/puppeteer', puppeteerRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', {
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
// SERVER STARTUP
// =============================================================================

const server = app.listen(PORT, () => {
  logger.info(`Puppeteer service started`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
