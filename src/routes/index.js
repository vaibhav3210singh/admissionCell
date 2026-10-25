import express from 'express';
import path from 'path';
import config from '../config/index.js';
import askRoutes from './askRoutes.js';
import healthRoutes from './healthRoutes.js';
import adminRoutes from './adminRoutes.js';
import telephonyRoutes from './telephonyRoutes.js';

const router = express.Router();

// Mount API routes
router.use('/ask', askRoutes);
router.use('/health', healthRoutes);
router.use('/admin', adminRoutes);
router.use('/', telephonyRoutes);

// Frontend root route
router.get('/', (req, res) => {
  res.sendFile(path.join(config.paths.public, 'index.html'));
});

// Root-level fallbacks for public admin static assets
router.get('/admin.css', (req, res) => {
  res.type('text/css');
  res.sendFile(path.join(config.paths.public, 'admin', 'admin.css'));
});

router.get('/admin.js', (req, res) => {
  res.type('text/javascript');
  res.sendFile(path.join(config.paths.public, 'admin', 'admin.js'));
});

export default router;
