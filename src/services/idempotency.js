/**
 * Puppeteer Service - Idempotency Service
 * Prevents duplicate form submissions in production mode
 */

const logger = require('../utils/logger');

// In-memory store for idempotency keys
// In production, consider using Redis or similar for distributed deployments
const idempotencyStore = new Map();

// TTL for idempotency keys (24 hours)
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

// Cleanup interval (1 hour)
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Idempotency record structure
 * @typedef {Object} IdempotencyRecord
 * @property {string} status - 'processing' | 'completed' | 'failed'
 * @property {number} createdAt - Timestamp when record was created
 * @property {Object|null} result - Stored result if completed
 * @property {string|null} error - Error message if failed
 */

/**
 * Generate idempotency key from RFQ ID and form URL
 * @param {string} rfqId - The RFQ UUID
 * @param {string} formUrl - The form submission URL
 * @param {boolean} isTestMode - Whether this is a test mode request
 * @returns {string} Idempotency key
 */
function generateIdempotencyKey(rfqId, formUrl, isTestMode) {
  // Include test mode in key so test submissions don't block production
  const mode = isTestMode ? 'test' : 'prod';
  return `${rfqId}:${mode}:${formUrl}`;
}

/**
 * Check if a request is already being processed or was completed
 * @param {string} key - Idempotency key
 * @returns {IdempotencyRecord|null} Existing record or null
 */
function checkIdempotency(key) {
  const record = idempotencyStore.get(key);

  if (!record) {
    return null;
  }

  // Check if record has expired
  if (Date.now() - record.createdAt > IDEMPOTENCY_TTL_MS) {
    idempotencyStore.delete(key);
    return null;
  }

  return record;
}

/**
 * Start processing a request (mark as in-progress)
 * @param {string} key - Idempotency key
 * @returns {boolean} True if successfully started, false if already exists
 */
function startProcessing(key) {
  const existing = checkIdempotency(key);

  if (existing) {
    logger.warn('Idempotency check failed - request already exists', {
      key,
      status: existing.status,
      createdAt: new Date(existing.createdAt).toISOString()
    });
    return false;
  }

  idempotencyStore.set(key, {
    status: 'processing',
    createdAt: Date.now(),
    result: null,
    error: null
  });

  logger.debug('Idempotency key created', { key });
  return true;
}

/**
 * Mark a request as completed with result
 * @param {string} key - Idempotency key
 * @param {Object} result - The result to store
 */
function markCompleted(key, result) {
  const record = idempotencyStore.get(key);

  if (record) {
    record.status = 'completed';
    record.result = result;
    idempotencyStore.set(key, record);
    logger.debug('Idempotency key marked completed', { key });
  }
}

/**
 * Mark a request as failed
 * @param {string} key - Idempotency key
 * @param {string} error - Error message
 */
function markFailed(key, error) {
  const record = idempotencyStore.get(key);

  if (record) {
    record.status = 'failed';
    record.error = error;
    idempotencyStore.set(key, record);
    logger.debug('Idempotency key marked failed', { key, error });
  }
}

/**
 * Remove an idempotency key (for allowing retries after failure)
 * @param {string} key - Idempotency key
 */
function removeKey(key) {
  idempotencyStore.delete(key);
  logger.debug('Idempotency key removed', { key });
}

/**
 * Get current stats for monitoring
 * @returns {Object} Stats object
 */
function getStats() {
  return {
    totalKeys: idempotencyStore.size,
    processing: Array.from(idempotencyStore.values()).filter(r => r.status === 'processing').length,
    completed: Array.from(idempotencyStore.values()).filter(r => r.status === 'completed').length,
    failed: Array.from(idempotencyStore.values()).filter(r => r.status === 'failed').length
  };
}

/**
 * Cleanup expired keys
 */
function cleanup() {
  const now = Date.now();
  let removed = 0;

  for (const [key, record] of idempotencyStore.entries()) {
    if (now - record.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyStore.delete(key);
      removed++;
    }
  }

  if (removed > 0) {
    logger.info('Idempotency cleanup completed', { removed, remaining: idempotencyStore.size });
  }
}

// Start cleanup interval
const cleanupInterval = setInterval(cleanup, CLEANUP_INTERVAL_MS);

// Ensure cleanup interval doesn't prevent process exit
cleanupInterval.unref();

module.exports = {
  generateIdempotencyKey,
  checkIdempotency,
  startProcessing,
  markCompleted,
  markFailed,
  removeKey,
  getStats
};
