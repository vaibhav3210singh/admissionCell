import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Production-ready in-memory sliding window rate limiter.
 * Requires zero external dependencies, prevents DoS/abuse on the /ask endpoint.
 */
class MemoryRateLimiter {
  constructor(windowMs = 60000, maxRequests = 200) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();

    // Periodic cleanup of expired rate-limit records every 2 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 120000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.hits.entries()) {
      if (now - record.startTime > this.windowMs) {
        this.hits.delete(key);
      }
    }
  }

  middleware() {
    return (req, res, next) => {
      // Determine client IP
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                       req.socket?.remoteAddress ||
                       '127.0.0.1';

      const now = Date.now();
      let record = this.hits.get(clientIp);

      if (!record || (now - record.startTime) > this.windowMs) {
        record = { startTime: now, count: 1 };
        this.hits.set(clientIp, record);
      } else {
        record.count++;
      }

      const remaining = Math.max(0, this.maxRequests - record.count);
      const resetTime = Math.ceil((record.startTime + this.windowMs - now) / 1000);

      // Set standard rate limit headers
      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', resetTime);

      if (record.count > this.maxRequests) {
        logger.warn(`Rate limit exceeded for IP: ${clientIp} (${record.count}/${this.maxRequests} in window)`);
        res.setHeader('Retry-After', resetTime);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Too many requests from this IP. Please wait ${resetTime} seconds before trying again.`,
          retryAfterSeconds: resetTime
        });
      }

      next();
    };
  }
}

export const rateLimiter = new MemoryRateLimiter(
  config.rateLimit.windowMs,
  config.rateLimit.maxRequests
);

export default rateLimiter.middleware();
