import crypto from 'crypto';
import config from '../config/index.js';
import databaseService from '../services/databaseService.js';
import logger from '../utils/logger.js';

// Brute-force protection tracker
const failedAttempts = new Map();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Parses cookies from cookie header string.
 */
export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [name, value] = pair.trim().split('=');
    if (name && value) {
      cookies[name] = decodeURIComponent(value);
    }
  }
  return cookies;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(strA, strB) {
  if (typeof strA !== 'string' || typeof strB !== 'string') return false;
  const bufA = Buffer.from(strA, 'utf-8');
  const bufB = Buffer.from(strB, 'utf-8');
  if (bufA.length !== bufB.length) {
    // Constant time dummy compare to avoid timing leak
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks if an IP is currently locked out due to repeated wrong password attempts.
 */
export function checkBruteForceLockout(ip) {
  const record = failedAttempts.get(ip);
  if (!record) return { isLocked: false };

  const now = Date.now();
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return {
      isLocked: true,
      remainingSeconds,
      remainingMinutes: Math.ceil(remainingSeconds / 60)
    };
  }

  // Clear expired lockout
  if (record.lockedUntil && now >= record.lockedUntil) {
    failedAttempts.delete(ip);
  }

  return { isLocked: false };
}

/**
 * Registers a failed login attempt. Locks out IP if threshold reached.
 */
export function recordFailedAttempt(ip) {
  const now = Date.now();
  let record = failedAttempts.get(ip);

  if (!record || (now - record.firstAttemptTime > ATTEMPT_WINDOW_MS)) {
    record = { count: 1, firstAttemptTime: now, lockedUntil: null };
  } else {
    record.count++;
  }

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    logger.warn(`Security alert: IP ${ip} locked out of /admin for 15 minutes after ${record.count} failed attempts.`);
  }

  failedAttempts.set(ip, record);
  return record;
}

/**
 * Clears failed login attempts for an IP upon successful login.
 */
export function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

/**
 * Validates admin password against environment variable.
 */
export function verifyAdminPassword(password) {
  if (!password || !config.admin.password) return false;
  return timingSafeEqual(password, config.admin.password);
}

/**
 * Creates a cryptographically random session token.
 */
export async function createAdminSession(username = 'admin') {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + config.admin.sessionDurationMs;

  await databaseService.saveSession(token, username, expiresAt);
  return { token, expiresAt };
}

/**
 * Middleware: Requires active authenticated admin session.
 * Unauthenticated users are redirected to /admin/login (if HTML) or 401 (if JSON/API).
 */
export async function requireAdminSession(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies.admin_session || req.headers['x-admin-token'];
    const adminApiKey = req.headers['x-admin-key'] || req.query.key;

    // Allow programmatic admin API key access
    if (adminApiKey && timingSafeEqual(adminApiKey, config.admin.apiKey)) {
      req.adminUser = 'api_key_user';
      return next();
    }

    if (sessionToken) {
      const session = await databaseService.getSession(sessionToken);
      if (session) {
        req.adminUser = session.username;
        return next();
      }
    }

    // Authentication failed
    const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');

    if (acceptsHtml && req.method === 'GET') {
      return res.redirect('/admin/login');
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Admin authentication required. Please login at /admin/login.'
    });
  } catch (err) {
    logger.error('Error in requireAdminSession middleware:', err.message);
    next(err);
  }
}

export default {
  checkBruteForceLockout,
  recordFailedAttempt,
  clearFailedAttempts,
  verifyAdminPassword,
  createAdminSession,
  requireAdminSession,
  parseCookies
};
