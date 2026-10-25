import express from 'express';
import matchingService from '../services/matchingService.js';
import { validateAskRequest } from '../middleware/validator.js';
import rateLimiter from '../middleware/rateLimiter.js';

const router = express.Router();

/**
 * POST /ask
 * Main admission enquiry query endpoint.
 * Protected by rate limiting and input validation.
 */
router.post('/', rateLimiter, validateAskRequest, async (req, res, next) => {
  try {
    const question = req.sanitizedQuestion;
    const channel = req.body.channel || req.body.source || 'web';
    const language = req.body.language;
    const llmEnabled = req.body.llm !== undefined ? req.body.llm : (req.query.llm !== undefined ? req.query.llm === 'true' : undefined);

    const result = await matchingService.processAdmissionEnquiry(question, { channel, language, llmEnabled });
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
