import express from 'express';
import config from '../config/index.js';
import { getFaqCount, getEmbeddingStatus } from '../services/embeddingService.js';
import databaseService from '../services/databaseService.js';
import telephonyService from '../services/telephonyService.js';

const router = express.Router();

/**
 * GET /health
 * System health and diagnostic status endpoint.
 */
router.get('/', (req, res) => {
  const memUsage = process.memoryUsage();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    faqCount: getFaqCount(),
    threshold: config.matching.similarityThreshold,
    environment: config.server.nodeEnv,
    services: {
      embedding: getEmbeddingStatus(),
      database: databaseService.getStatus(),
      telephony: telephonyService.getStatus()
    },
    system: {
      nodeVersion: process.version,
      memoryHeapUsedMB: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
      memoryRssMB: (memUsage.rss / 1024 / 1024).toFixed(2)
    }
  });
});

export default router;
