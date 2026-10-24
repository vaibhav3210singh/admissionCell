import express from 'express';
import path from 'path';
import config from '../config/index.js';
import databaseService from '../services/databaseService.js';
import { reloadEmbeddings } from '../services/embeddingService.js';
import {
  requireAdminSession,
  verifyAdminPassword,
  createAdminSession,
  checkBruteForceLockout,
  recordFailedAttempt,
  clearFailedAttempts,
  parseCookies
} from '../middleware/adminAuth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Helper to get client IP
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.socket?.remoteAddress ||
         '127.0.0.1';
}

// ==========================================
// Authentication & Page Routes
// ==========================================

/**
 * GET /admin/login
 * Renders the admin login page or redirects to /admin if already logged in.
 */
router.get('/login', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_session) {
    const session = await databaseService.getSession(cookies.admin_session);
    if (session) {
      return res.redirect('/admin');
    }
  }
  res.sendFile(path.join(config.paths.public, 'admin', 'login.html'));
});

/**
 * Static styling and script for admin panel
 */
router.get('/admin.css', (req, res) => {
  res.type('text/css');
  res.sendFile(path.join(config.paths.public, 'admin', 'admin.css'));
});

router.get('/admin.js', (req, res) => {
  res.type('text/javascript');
  res.sendFile(path.join(config.paths.public, 'admin', 'admin.js'));
});

/**
 * POST /admin/login
 * Authenticates admin password, enforces brute force lockout, and issues secure session cookie.
 */
router.post('/login', async (req, res) => {
  const clientIp = getClientIp(req);
  const { password, username = 'admin' } = req.body || {};

  // 1. Check if IP is currently locked out
  const lockout = checkBruteForceLockout(clientIp);
  if (lockout.isLocked) {
    return res.status(429).json({
      error: 'Too Many Attempts',
      message: `Account temporarily locked due to repeated failed attempts. Please try again in ${lockout.remainingMinutes} minute(s).`,
      remainingSeconds: lockout.remainingSeconds
    });
  }

  // 2. Validate password
  const isValid = verifyAdminPassword(password);
  if (!isValid) {
    const record = recordFailedAttempt(clientIp);
    const attemptsLeft = Math.max(0, 5 - record.count);

    if (attemptsLeft === 0) {
      return res.status(429).json({
        error: 'Too Many Attempts',
        message: 'Account locked for 15 minutes due to 5 consecutive wrong password attempts.'
      });
    }

    return res.status(401).json({
      error: 'Invalid Credentials',
      message: `Incorrect admin password. You have ${attemptsLeft} attempt(s) remaining before lockout.`
    });
  }

  // 3. Clear failed attempts & create session
  clearFailedAttempts(clientIp);
  const { token } = await createAdminSession(username);

  // 4. Set HttpOnly, SameSite=Strict secure session cookie
  const maxAgeSeconds = Math.floor(config.admin.sessionDurationMs / 1000);
  res.setHeader(
    'Set-Cookie',
    `admin_session=${token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`
  );

  return res.json({
    success: true,
    message: 'Authentication successful',
    redirectUrl: '/admin'
  });
});

/**
 * POST /admin/logout or GET /admin/logout
 * Destroys session and clears cookie.
 */
router.all('/logout', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_session) {
    await databaseService.deleteSession(cookies.admin_session);
  }

  res.setHeader('Set-Cookie', 'admin_session=; Path=/admin; HttpOnly; Max-Age=0');
  
  if (req.headers.accept?.includes('text/html')) {
    return res.redirect('/admin/login');
  }
  return res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /admin
 * Serves the Admin Panel single-page application (protected).
 */
router.get(['/', '/index.html'], requireAdminSession, (req, res) => {
  res.sendFile(path.join(config.paths.public, 'admin', 'index.html'));
});

// ==========================================
// Admin REST APIs (Protected by requireAdminSession)
// ==========================================

/**
 * GET /admin/api/stats
 * Returns overall enquiry counts, % answered, % handed off, total FAQs.
 */
router.get('/api/stats', requireAdminSession, async (req, res, next) => {
  try {
    const stats = await databaseService.getStats();
    res.json({
      ...stats,
      threshold: config.matching.similarityThreshold,
      databaseProvider: config.database.type
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/api/logs
 * Returns filtered enquiry logs.
 */
router.get('/api/logs', requireAdminSession, async (req, res, next) => {
  try {
    const { status, channel, search, limit = '50', offset = '0' } = req.query;
    const result = await databaseService.getEnquiryLogs({
      status,
      channel,
      search,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/api/handed-off
 * Returns questions that triggered human staff handoff (helps staff see FAQ gaps).
 */
router.get('/api/handed-off', requireAdminSession, async (req, res, next) => {
  try {
    const { limit = '50', offset = '0' } = req.query;
    const result = await databaseService.getHandedOffLogs({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/api/export-csv
 * Exports enquiry logs as downloadable CSV file.
 */
router.get('/api/export-csv', requireAdminSession, async (req, res, next) => {
  try {
    const { status, channel } = req.query;
    const csvContent = await databaseService.exportLogsCSV({ status, channel });
    const filename = `admission_enquiries_${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/api/faqs
 * Lists all FAQs stored in the database.
 */
router.get('/api/faqs', requireAdminSession, async (req, res, next) => {
  try {
    const faqs = await databaseService.loadFAQs();
    res.json({ count: faqs.length, faqs });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/api/faqs
 * Adds a new FAQ entry and automatically reloads embeddings.
 */
router.post('/api/faqs', requireAdminSession, async (req, res, next) => {
  try {
    const { question, answer } = req.body || {};

    if (!question || !question.trim() || !answer || !answer.trim()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Both "question" and "answer" fields are required and cannot be empty.'
      });
    }

    const created = await databaseService.createFAQ(question, answer);
    
    // Automatically re-compute & reload vector embeddings
    const reloadedCount = await reloadEmbeddings();

    logger.info(`[ADMIN] Added new FAQ #${created.id}: "${created.question}". Embeddings reloaded (${reloadedCount} total).`);
    res.status(201).json({
      success: true,
      message: 'FAQ created successfully and AI embeddings reloaded.',
      faq: created,
      totalFaqs: reloadedCount
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /admin/api/faqs/:id
 * Updates an existing FAQ entry and automatically reloads embeddings.
 */
router.put('/api/faqs/:id', requireAdminSession, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { question, answer } = req.body || {};

    if (!question || !question.trim() || !answer || !answer.trim()) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Both "question" and "answer" fields are required.'
      });
    }

    const updated = await databaseService.updateFAQ(id, question, answer);
    const reloadedCount = await reloadEmbeddings();

    logger.info(`[ADMIN] Updated FAQ #${id}. Embeddings reloaded (${reloadedCount} total).`);
    res.json({
      success: true,
      message: 'FAQ updated successfully and AI embeddings reloaded.',
      faq: updated,
      totalFaqs: reloadedCount
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /admin/api/faqs/:id
 * Deletes an FAQ entry and automatically reloads embeddings.
 */
router.delete('/api/faqs/:id', requireAdminSession, async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await databaseService.deleteFAQ(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Not Found', message: `FAQ with ID ${id} not found.` });
    }

    const reloadedCount = await reloadEmbeddings();
    logger.info(`[ADMIN] Deleted FAQ #${id}. Embeddings reloaded (${reloadedCount} total).`);

    res.json({
      success: true,
      message: 'FAQ deleted successfully and AI embeddings reloaded.',
      totalFaqs: reloadedCount
    });
  } catch (err) {
    next(err);
  }
});

export default router;
