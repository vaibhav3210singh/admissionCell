import express from 'express';
import telephonyService, { validateTwilioSignature } from '../services/telephonyService.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * POST /incoming-call and GET /incoming-call
 * Main webhook endpoint called by Twilio when a user dials the university admission number.
 * Returns TwiML that initiates ConversationRelay (WebSocket) or Gather speech loop.
 */
router.all('/incoming-call', (req, res) => {
  // Validate Twilio signature
  const isValid = validateTwilioSignature(req);
  if (!isValid) {
    logger.warn('[TELEPHONY] Rejected unverified webhook request to /incoming-call');
    return res.status(403).send('Forbidden: Invalid Twilio Signature');
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const caller = req.body?.From || req.query?.From || 'Unknown';

  const twiml = telephonyService.generateIncomingCallTwiML({ host, caller });
  res.type('text/xml');
  return res.send(twiml);
});

/**
 * POST /incoming-call/gather
 * Fallback webhook for Gather mode: receives speech recognition result and plays answer.
 */
router.post('/incoming-call/gather', async (req, res) => {
  const isValid = validateTwilioSignature(req);
  if (!isValid) {
    logger.warn('[TELEPHONY] Rejected unverified request to /incoming-call/gather');
    return res.status(403).send('Forbidden: Invalid Twilio Signature');
  }

  const speechResult = req.body?.SpeechResult || '';
  const caller = req.body?.From || 'Unknown';

  const twiml = await telephonyService.handleGatherResponse(speechResult, caller);
  res.type('text/xml');
  return res.send(twiml);
});

/**
 * POST /incoming-call/ended
 * Twilio action callback when ConversationRelay ends or call disconnects.
 */
router.all('/incoming-call/ended', (req, res) => {
  res.type('text/xml');
  return res.send('<Response></Response>');
});

export default router;
