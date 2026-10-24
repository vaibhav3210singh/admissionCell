import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * 404 Not Found Middleware
 */
export function notFoundHandler(req, res, next) {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    suggestion: 'Available endpoints: GET /, POST /ask, GET /health, GET /admin/status'
  });
}

/**
 * Global Error Handler Middleware
 * Catches any unhandled exceptions to prevent server crashes.
 */
export function globalErrorHandler(err, req, res, next) {
  logger.error(`Unhandled request error on [${req.method} ${req.url}]:`, err.stack || err.message);

  const statusCode = err.status || err.statusCode || 500;
  const isDev = !config.server.isProduction;

  res.status(statusCode).json({
    error: err.name || 'Internal Server Error',
    message: err.message || 'An unexpected error occurred while processing your enquiry.',
    ...(isDev && { stack: err.stack })
  });
}

export default {
  notFoundHandler,
  globalErrorHandler
};
