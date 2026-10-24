import config from './src/config/index.js';
import { createApp, initializeServices } from './src/app.js';
import logger from './src/utils/logger.js';

// Catch unhandled process exceptions gracefully
process.on('uncaughtException', (err) => {
  logger.error('CRITICAL UNCAUGHT EXCEPTION:', err.stack || err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('CRITICAL UNHANDLED REJECTION:', reason?.stack || reason);
});

/**
 * Main application bootstrap function.
 */
async function startServer() {
  try {
    // 1. Initialize services (database, embeddings, telephony)
    const { faqCount } = await initializeServices();

    // 2. Create Express application
    const app = createApp();

    // 3. Start HTTP Listener
    const PORT = config.server.port;
    const server = app.listen(PORT, () => {
      console.log(`\n======================================================`);
      console.log(` AI Admission Enquiry Assistant Backend is RUNNING!`);
      console.log(` URL           : http://localhost:${PORT}`);
      console.log(` POST Endpoint : http://localhost:${PORT}/ask`);
      console.log(` Health Status : http://localhost:${PORT}/health`);
      console.log(` Web Assistant : http://localhost:${PORT}/`);
      console.log(` Threshold     : ${config.matching.similarityThreshold}`);
      console.log(` Model         : ${config.embedding.model} (${config.embedding.provider})`);
      console.log(` Total FAQs    : ${faqCount}`);
      console.log(` Environment   : ${config.server.nodeEnv}`);
      console.log(`======================================================\n`);
    });

    // Graceful shutdown handling
    const shutdown = (signal) => {
      logger.info(`Received ${signal}. Shutting down HTTP server gracefully...`);
      server.close(() => {
        logger.info('HTTP server closed. Exiting process.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (error) {
    logger.error('Fatal startup error:', error.stack || error);
    process.exit(1);
  }
}

startServer();
