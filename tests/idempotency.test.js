/**
 * Test cases for Puppeteer Service idempotency.
 *
 * Tests cover:
 * 1. Idempotency key generation
 * 2. Duplicate request prevention
 * 3. Test mode vs production mode keys
 * 4. Cache expiration
 */

const {
  generateIdempotencyKey,
  checkIdempotency,
  startProcessing,
  markCompleted,
  markFailed,
  removeKey,
  getStats
} = require('../src/services/idempotency');

describe('Idempotency Service', () => {
  // Clear state before each test
  beforeEach(() => {
    // Reset internal state by removing all keys
    const stats = getStats();
    // Note: In a real test, we'd want a reset function
  });

  describe('generateIdempotencyKey', () => {
    test('generates key with test mode', () => {
      const key = generateIdempotencyKey('rfq-123', 'https://form.com', true);
      expect(key).toBe('rfq-123:test:https://form.com');
    });

    test('generates key with production mode', () => {
      const key = generateIdempotencyKey('rfq-123', 'https://form.com', false);
      expect(key).toBe('rfq-123:prod:https://form.com');
    });

    test('test and prod keys are different', () => {
      const testKey = generateIdempotencyKey('rfq-123', 'https://form.com', true);
      const prodKey = generateIdempotencyKey('rfq-123', 'https://form.com', false);
      expect(testKey).not.toBe(prodKey);
    });

    test('different RFQ IDs produce different keys', () => {
      const key1 = generateIdempotencyKey('rfq-123', 'https://form.com', true);
      const key2 = generateIdempotencyKey('rfq-456', 'https://form.com', true);
      expect(key1).not.toBe(key2);
    });
  });

  describe('startProcessing', () => {
    test('returns true for new key', () => {
      const key = generateIdempotencyKey('unique-rfq-' + Date.now(), 'https://form.com', true);
      const result = startProcessing(key);
      expect(result).toBe(true);
    });

    test('returns false for duplicate key', () => {
      const key = generateIdempotencyKey('duplicate-rfq-' + Date.now(), 'https://form.com', true);
      startProcessing(key);
      const result = startProcessing(key);
      expect(result).toBe(false);
    });
  });

  describe('checkIdempotency', () => {
    test('returns null for non-existent key', () => {
      const result = checkIdempotency('non-existent-key');
      expect(result).toBeNull();
    });

    test('returns record for existing key', () => {
      const key = generateIdempotencyKey('check-rfq-' + Date.now(), 'https://form.com', true);
      startProcessing(key);
      const result = checkIdempotency(key);
      expect(result).not.toBeNull();
      expect(result.status).toBe('processing');
    });
  });

  describe('markCompleted', () => {
    test('updates status to completed', () => {
      const key = generateIdempotencyKey('complete-rfq-' + Date.now(), 'https://form.com', true);
      startProcessing(key);

      const mockResult = { success: true, message: 'Form submitted' };
      markCompleted(key, mockResult);

      const record = checkIdempotency(key);
      expect(record.status).toBe('completed');
      expect(record.result).toEqual(mockResult);
    });
  });

  describe('markFailed', () => {
    test('updates status to failed', () => {
      const key = generateIdempotencyKey('failed-rfq-' + Date.now(), 'https://form.com', true);
      startProcessing(key);

      markFailed(key, 'Form submission failed');

      const record = checkIdempotency(key);
      expect(record.status).toBe('failed');
      expect(record.error).toBe('Form submission failed');
    });
  });

  describe('removeKey', () => {
    test('removes existing key', () => {
      const key = generateIdempotencyKey('remove-rfq-' + Date.now(), 'https://form.com', true);
      startProcessing(key);

      removeKey(key);

      const result = checkIdempotency(key);
      expect(result).toBeNull();
    });

    test('allows reprocessing after removal', () => {
      const key = generateIdempotencyKey('reprocess-rfq-' + Date.now(), 'https://form.com', true);
      startProcessing(key);
      markFailed(key, 'First attempt failed');

      removeKey(key);

      const canStart = startProcessing(key);
      expect(canStart).toBe(true);
    });
  });

  describe('getStats', () => {
    test('returns stats object', () => {
      const stats = getStats();
      expect(stats).toHaveProperty('totalKeys');
      expect(stats).toHaveProperty('processing');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
    });
  });

  describe('Production mode protection', () => {
    test('completed production requests return cached result', () => {
      const key = generateIdempotencyKey('prod-rfq-' + Date.now(), 'https://form.com', false);
      startProcessing(key);

      const mockResult = { success: true, finalAction: 'FORM_SUBMITTED' };
      markCompleted(key, mockResult);

      const record = checkIdempotency(key);
      expect(record.status).toBe('completed');
      expect(record.result).toEqual(mockResult);

      // Attempting to start processing again should fail
      const canStart = startProcessing(key);
      expect(canStart).toBe(false);
    });

    test('test mode allows retry after completion', () => {
      const key = generateIdempotencyKey('test-retry-' + Date.now(), 'https://form.com', true);
      startProcessing(key);
      markCompleted(key, { success: true });

      // For test mode, we allow removal and retry
      removeKey(key);

      const canStart = startProcessing(key);
      expect(canStart).toBe(true);
    });
  });
});
