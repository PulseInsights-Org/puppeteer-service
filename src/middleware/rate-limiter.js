/**
 * Puppeteer Service - Rate Limiter Middleware
 * Isolated rate limiting for puppeteer endpoints
 */

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.PUPPETEER_RATE_LIMIT_WINDOW_MS, 10) || 60000;
const RATE_LIMIT_MAX_REQUESTS = parseInt(process.env.PUPPETEER_RATE_LIMIT_MAX_REQUESTS, 10) || 10;

const rateLimitStore = new Map();

function rateLimit(windowMs = RATE_LIMIT_WINDOW_MS, maxRequests = RATE_LIMIT_MAX_REQUESTS) {
  return (req, res, next) => {
    const key = `puppeteer:${req.ip || req.connection.remoteAddress || 'unknown'}`;
    const now = Date.now();

    if (!rateLimitStore.has(key)) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    const record = rateLimitStore.get(key);

    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + windowMs;
      return next();
    }

    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: 'Too many requests to puppeteer service',
        retryAfter
      });
    }

    record.count++;
    next();
  };
}

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

module.exports = { rateLimit };
