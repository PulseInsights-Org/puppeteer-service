/**
 * Unit tests for rate limiter middleware
 */

describe('Rate Limiter Middleware', () => {
  let rateLimit;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    jest.resetModules();
    // Clear any module cache
    jest.isolateModules(() => {
      ({ rateLimit } = require('../../src/middleware/rate-limiter'));
    });

    mockReq = {
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' }
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis()
    };

    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('basic rate limiting', () => {
    it('should allow first request', () => {
      const middleware = rateLimit(60000, 10);
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should allow requests within limit', () => {
      const middleware = rateLimit(60000, 5);

      for (let i = 0; i < 5; i++) {
        mockNext.mockClear();
        middleware(mockReq, mockRes, mockNext);
        expect(mockNext).toHaveBeenCalled();
      }
    });

    it('should block requests exceeding limit', () => {
      const middleware = rateLimit(60000, 3);

      // Make 3 allowed requests
      for (let i = 0; i < 3; i++) {
        mockNext.mockClear();
        middleware(mockReq, mockRes, mockNext);
      }

      // 4th request should be blocked
      mockNext.mockClear();
      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Too many requests to puppeteer service'
        })
      );
    });

    it('should include retryAfter in response', () => {
      const middleware = rateLimit(60000, 1);

      // First request succeeds
      middleware(mockReq, mockRes, mockNext);

      // Second request is blocked
      mockNext.mockClear();
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          retryAfter: expect.any(Number)
        })
      );
    });
  });

  describe('IP-based tracking', () => {
    it('should track different IPs separately', () => {
      const middleware = rateLimit(60000, 2);

      // IP 1 makes 2 requests
      mockReq.ip = '192.168.1.1';
      middleware(mockReq, mockRes, mockNext);
      middleware(mockReq, mockRes, mockNext);

      // IP 1's 3rd request should be blocked
      mockNext.mockClear();
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();

      // IP 2 should still be allowed
      mockReq.ip = '192.168.1.2';
      mockNext.mockClear();
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should fallback to connection.remoteAddress when ip is undefined', () => {
      const middleware = rateLimit(60000, 10);

      mockReq.ip = undefined;
      mockReq.connection = { remoteAddress: '10.0.0.1' };

      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle unknown IP gracefully', () => {
      const middleware = rateLimit(60000, 10);

      mockReq.ip = undefined;
      mockReq.connection = { remoteAddress: undefined };

      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('window reset', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should reset count after window expires', () => {
      const windowMs = 1000;
      const middleware = rateLimit(windowMs, 2);

      // Use up the limit
      middleware(mockReq, mockRes, mockNext);
      middleware(mockReq, mockRes, mockNext);

      // This should be blocked
      mockNext.mockClear();
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();

      // Advance time past the window
      jest.advanceTimersByTime(windowMs + 100);

      // Should be allowed again
      mockNext.mockClear();
      mockRes.status.mockClear();
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('default configuration', () => {
    it('should use default values when not provided', () => {
      const middleware = rateLimit();

      // Should work with defaults (60000ms, 10 requests)
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('custom configuration', () => {
    it('should accept custom window and max requests', () => {
      const middleware = rateLimit(30000, 5);

      // Make 5 requests (all should pass)
      for (let i = 0; i < 5; i++) {
        mockNext.mockClear();
        middleware(mockReq, mockRes, mockNext);
        expect(mockNext).toHaveBeenCalled();
      }

      // 6th should fail
      mockNext.mockClear();
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should work with very short window', () => {
      jest.useFakeTimers();
      const middleware = rateLimit(100, 1);

      // First request passes
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();

      // Second request blocked
      mockNext.mockClear();
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).not.toHaveBeenCalled();

      // After window resets
      jest.advanceTimersByTime(150);
      mockNext.mockClear();
      mockRes.status.mockClear();
      middleware(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('response format', () => {
    it('should return correct error structure when rate limited', () => {
      const middleware = rateLimit(60000, 1);

      middleware(mockReq, mockRes, mockNext);
      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: 'Too many requests to puppeteer service',
        retryAfter: expect.any(Number)
      });
    });

    it('should set Retry-After header correctly', () => {
      jest.useFakeTimers();
      const setTime = Date.now();
      jest.setSystemTime(setTime);

      const middleware = rateLimit(60000, 1);

      middleware(mockReq, mockRes, mockNext);

      // Advance 30 seconds
      jest.advanceTimersByTime(30000);

      middleware(mockReq, mockRes, mockNext);

      // Should have approximately 30 seconds left
      expect(mockRes.set).toHaveBeenCalledWith('Retry-After', '30');

      jest.useRealTimers();
    });
  });

  describe('concurrent requests', () => {
    it('should handle rapid successive requests correctly', () => {
      const middleware = rateLimit(60000, 3);

      // Simulate rapid requests
      const results = [];
      for (let i = 0; i < 5; i++) {
        mockNext.mockClear();
        mockRes.status.mockClear();
        middleware(mockReq, mockRes, mockNext);
        results.push({
          allowed: mockNext.mock.calls.length > 0,
          blocked: mockRes.status.mock.calls.length > 0
        });
      }

      // First 3 should be allowed, last 2 blocked
      expect(results[0].allowed).toBe(true);
      expect(results[1].allowed).toBe(true);
      expect(results[2].allowed).toBe(true);
      expect(results[3].blocked).toBe(true);
      expect(results[4].blocked).toBe(true);
    });
  });
});
