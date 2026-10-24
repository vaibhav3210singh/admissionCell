import express from 'express';
import cors from 'cors';
import config from './config/index.js';
import routes from './routes/index.js';
import databaseService from './services/databaseService.js';
import { initializeEmbeddingService } from './services/embeddingService.js';
import telephonyService from './services/telephonyService.js';
import { notFoundHandler, globalErrorHandler } from './middleware/errorHandler.js';
import logger from './utils/logger.js';

/**
 * Creates and configures the Express application.
 */
export function createApp() {
  const app = express();

  // Security Headers Middleware (strict MIME checking, clickjacking protection, CSP)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self';"
    );
    next();
  });

  // Core Middleware
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Application Routes mounted FIRST (protects /admin before static file serving)
  app.use('/', routes);

  // Static Assets for public web UI
  app.use(express.static(config.paths.public, { index: false }));

  // 404 Handler for undefined routes
  app.use(notFoundHandler);

  // Global Error Handler (prevents crashes, logs stacks, returns clean JSON)
  app.use(globalErrorHandler);

  return app;
}

/**
 * Bootstraps all underlying services before starting the HTTP listener.
 */
export async function initializeServices() {
  logger.info('Starting service initialization sequence...');

  // 1. Initialize Database / Storage (SQLite or Postgres)
  await databaseService.initialize();

  // 2. Initialize Telephony Service
  await telephonyService.initialize();

  // 3. Pre-load embedding model and compute FAQ vectors
  const faqCount = await initializeEmbeddingService();

  logger.info(`Service initialization complete. Total FAQs ready: ${faqCount}`);
  return { faqCount };
}

export default createApp;
