import { WebSocketServer } from 'ws';
import twilio from 'twilio';
import config from '../config/index.js';
import matchingService from './matchingService.js';
import logger from '../utils/logger.js';

/**
 * Masks a caller phone number to preserve privacy.
 * Retains only the last 4 digits (e.g. +919876543210 -> ***-***-3210).
 * Never logs or stores full personal phone numbers.
 * @param {string} phone
 * @returns {string}
 */
export function maskPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return 'Unknown';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length < 4) return '***-***-XXXX';
  const last4 = clean.slice(-4);
  return `***-***-${last4}`;
}

/**
 * Detects whether a spoken text is predominantly Hindi/Hinglish or English.
 * @param {string} text
 * @returns {string} 'hi-IN' | 'en-IN'
 */
export function detectSpokenLanguage(text) {
  if (!text || typeof text !== 'string') return 'en-IN';
  // Check for Devanagari Unicode block
  if (/[\u0900-\u097F]/.test(text)) return 'hi-IN';

  // Check for common Romanized Hindi / Hinglish keywords
  const hinglishTokens = [
    'kya', 'hai', 'hain', 'kaise', 'kab', 'kitna', 'kitni', 'chahiye',
    'milega', 'hoga', 'mera', 'meri', 'karna', 'karein', 'admission',
    'bataiye', 'fees', 'hostel', 'daakhila', 'pravesh', 'shulk', 'padhai',
    'kaha', 'yaha', 'sakte', 'sakta', 'nahi', 'haan', 'ji'
  ];
  const words = text.toLowerCase().split(/\s+/);
  const hindiCount = words.filter(w => hinglishTokens.includes(w)).length;
  return (hindiCount >= 2 || (words.length <= 4 && hindiCount >= 1)) ? 'hi-IN' : 'en-IN';
}

/**
 * Validates Twilio HTTP webhook signature to ensure request came from Twilio.
 * @param {Object} req - Express request
 * @returns {boolean}
 */
export function validateTwilioSignature(req) {
  const authToken = config.telephony.authToken;
  // In development, local simulation, or when no token configured, allow request
  if (!authToken || config.server.nodeEnv === 'development' || req.headers['x-simulator'] === 'true') {
    return true;
  }

  const twilioSignature = req.headers['x-twilio-signature'];
  if (!twilioSignature) {
    logger.warn('[TELEPHONY] Missing X-Twilio-Signature header on webhook request.');
    return false;
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const fullUrl = `${protocol}://${host}${req.originalUrl}`;
  const params = req.body || {};

  try {
    return twilio.validateRequest(authToken, twilioSignature, fullUrl, params);
  } catch (err) {
    logger.error('[TELEPHONY] Signature verification error:', err.message);
    return false;
  }
}

/**
 * Production Telephony Service supporting Twilio ConversationRelay (WebSocket)
 * and classic Gather TwiML fallback.
 */
class TelephonyService {
  constructor() {
    this.provider = config.telephony.provider;
    this.callMode = config.telephony.callMode; // 'conversationrelay' | 'gather'
    this.accountSid = config.telephony.accountSid;
    this.authToken = config.telephony.authToken;
    this.phoneNumber = config.telephony.phoneNumber;
    this.ttsProvider = config.telephony.ttsProvider;
    this.ttsVoiceEn = config.telephony.ttsVoiceEn;
    this.ttsVoiceHi = config.telephony.ttsVoiceHi;
    this.wss = null;
    this.activeCalls = new Map();
  }

  /**
   * Initializes telephony configuration.
   */
  async initialize() {
    logger.info(`Telephony service initialized [Provider: ${this.provider.toUpperCase()}, Mode: ${this.callMode.toUpperCase()}]`);
    logger.info(`TTS Provider: ${this.ttsProvider.toUpperCase()} | Voice EN: ${this.ttsVoiceEn} | Voice HI: ${this.ttsVoiceHi}`);
    return true;
  }

  /**
   * Attaches the WebSocket Server to the running HTTP server instance for ConversationRelay.
   * @param {import('http').Server} httpServer
   */
  attachWebSocketServer(httpServer) {
    if (this.wss) return;

    this.wss = new WebSocketServer({ server: httpServer, path: '/call-relay' });
    logger.info('[TELEPHONY] ConversationRelay WebSocket server attached at /call-relay');

    this.wss.on('connection', (ws, req) => {
      logger.info(`[TELEPHONY] Inbound ConversationRelay WebSocket connected from ${req.socket.remoteAddress}`);
      
      let sessionState = {
        sessionId: null,
        callSid: null,
        callerNumber: 'Unknown',
        detectedLanguage: 'en-IN',
        turnCount: 0,
        lastSpokenText: '',
        acknowledgmentTimer: null
      };

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleRelayMessage(ws, message, sessionState);
        } catch (err) {
          logger.error('[TELEPHONY] Error processing relay message:', err.message);
          this.sendSafeErrorSpeech(ws, sessionState);
        }
      });

      ws.on('close', () => {
        if (sessionState.acknowledgmentTimer) {
          clearTimeout(sessionState.acknowledgmentTimer);
        }
        if (sessionState.callSid) {
          this.activeCalls.delete(sessionState.callSid);
          logger.info(`[TELEPHONY] Call ended for ${sessionState.callSid} (Masked: ${sessionState.callerNumber})`);
        }
      });

      ws.on('error', (err) => {
        logger.error('[TELEPHONY] WebSocket error:', err.message);
      });
    });
  }

  /**
   * Handles incoming ConversationRelay JSON protocol frames.
   */
  async handleRelayMessage(ws, message, state) {
    switch (message.type) {
      case 'setup': {
        state.sessionId = message.sessionId;
        state.callSid = message.callSid;
        state.callerNumber = maskPhoneNumber(message.from);
        this.activeCalls.set(state.callSid, state);
        logger.info(`[TELEPHONY] Setup session ${state.sessionId} for call ${state.callSid} from ${state.callerNumber}`);
        break;
      }

      case 'prompt': {
        const callerSpeech = message.voicePrompt;
        if (!callerSpeech || !callerSpeech.trim()) {
          return;
        }

        state.turnCount++;
        // Detect language on caller's input
        state.detectedLanguage = detectSpokenLanguage(callerSpeech);
        const isHindi = state.detectedLanguage === 'hi-IN';

        logger.info(`[TELEPHONY] Caller said [${state.detectedLanguage}]: "${callerSpeech}"`);

        // Natural Acknowledgment: If query processing takes > 1.5s, send short filler to prevent silence
        state.acknowledgmentTimer = setTimeout(() => {
          if (ws.readyState === ws.OPEN) {
            const fillerToken = isHindi ? 'जी, एक सेकंड... ' : 'Sure, one moment... ';
            logger.info(`[TELEPHONY] Sending natural filler acknowledgment: "${fillerToken.trim()}"`);
            ws.send(JSON.stringify({
              type: 'text',
              token: fillerToken,
              last: false
            }));
          }
        }, 1500);

        try {
          // Send to matchingService (reusing identical university admission logic across channels)
          const result = await matchingService.processAdmissionEnquiry(callerSpeech, {
            channel: 'phone',
            language: state.detectedLanguage,
            callerNumber: state.callerNumber,
            isPhoneCall: true
          });

          // Cancel filler acknowledgment timer if answer arrived
          clearTimeout(state.acknowledgmentTimer);

          let spokenAnswer = result.answer;

          // Append "anything else?" prompt at the end of each answer if not handed off
          if (!result.handoff) {
            const promptNext = isHindi 
              ? ' क्या मैं आपकी किसी और चीज़ में मदद कर सकता हूँ?'
              : ' Is there anything else I can help you with?';
            spokenAnswer = `${spokenAnswer} ${promptNext}`.trim();
          }

          state.lastSpokenText = spokenAnswer;

          // Send synthesized spoken response back to ConversationRelay
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'text',
              token: spokenAnswer,
              last: true
            }));
          }

        } catch (queryErr) {
          clearTimeout(state.acknowledgmentTimer);
          logger.error('[TELEPHONY] Error generating answer:', queryErr.message);
          this.sendSafeErrorSpeech(ws, state);
        }
        break;
      }

      case 'interrupt': {
        const heardSoFar = message.utteranceUntilInterrupt || '';
        logger.info(`[TELEPHONY] Caller interrupted after hearing: "${heardSoFar}"`);
        state.lastSpokenText = heardSoFar;
        break;
      }

      default:
        logger.debug(`[TELEPHONY] Received unhandled message type: ${message.type}`);
    }
  }

  /**
   * Sends polite fallback speech on any unexpected runtime error (never leaves caller in silence).
   */
  sendSafeErrorSpeech(ws, state) {
    if (ws && ws.readyState === ws.OPEN) {
      const isHindi = state?.detectedLanguage === 'hi-IN';
      const safeMsg = isHindi
        ? 'क्षमा करें, हमारे सिस्टम में कुछ तकनीकी समस्या आई है। कृपया लाइन पर रहें, मैं आपको हमारे सहायता केंद्र से जोड़ रहा हूँ।'
        : 'I apologize, but we are experiencing a technical difficulty. Please stay on the line while I connect you to our admission helpdesk.';
      ws.send(JSON.stringify({
        type: 'text',
        token: safeMsg,
        last: true
      }));
    }
  }

  /**
   * Generates TwiML response for /incoming-call webhook.
   * @param {Object} params
   * @param {string} params.host - Host header for WebSocket URL resolution
   * @param {string} [params.caller] - Caller phone number
   * @returns {string} XML TwiML string
   */
  generateIncomingCallTwiML({ host, caller }) {
    const masked = maskPhoneNumber(caller);
    logger.info(`[TELEPHONY] Incoming call received from ${masked} (Mode: ${this.callMode})`);

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    const bilingualGreeting = 
      'Welcome to MMMUT Admission Helpline. How can I help you today? ' +
      'एमएमएमयूटी प्रवेश सहायता केंद्र में आपका स्वागत है।';

    if (this.callMode === 'conversationrelay') {
      // MODE 1: Twilio ConversationRelay via WebSockets
      const protocol = host.includes('localhost') ? 'ws' : 'wss';
      const wsUrl = `${protocol}://${host}/call-relay`;

      const connect = response.connect({
        action: `/incoming-call/ended`
      });

      connect.conversationRelay({
        url: wsUrl,
        welcomeGreeting: bilingualGreeting,
        ttsProvider: this.ttsProvider,
        voice: this.ttsVoiceEn,
        language: 'en-IN',
        transcriptionProvider: 'google',
        interruptible: 'true'
      });

      return response.toString();
    } else {
      // MODE 2: Classic Gather fallback
      const gather = response.gather({
        input: 'speech',
        action: '/incoming-call/gather',
        method: 'POST',
        language: 'hi-IN',
        speechTimeout: 'auto',
        hints: 'admission, fees, eligibility, hostel, cut off, dates'
      });

      gather.say({
        voice: this.ttsVoiceHi.includes('Polly') ? 'Polly.Aditi' : 'Google.hi-IN-Neural2-A',
        language: 'hi-IN'
      }, bilingualGreeting);

      // If user remains silent, prompt once more or transfer
      response.say('We did not receive any input. Connecting you to admission staff.');
      response.dial(config.handoff.phone);

      return response.toString();
    }
  }

  /**
   * Handles Gather speech recognition result in Gather fallback mode.
   * @param {string} speechResult
   * @param {string} caller
   * @returns {Promise<string>} XML TwiML
   */
  async handleGatherResponse(speechResult, caller) {
    const masked = maskPhoneNumber(caller);
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const response = new VoiceResponse();

    if (!speechResult || !speechResult.trim()) {
      response.say({
        voice: 'Google.en-IN-Neural2-A',
        language: 'en-IN'
      }, 'I did not catch that. Please hold while I connect you to our admission staff.');
      response.dial(config.handoff.phone);
      return response.toString();
    }

    const lang = detectSpokenLanguage(speechResult);
    const isHindi = lang === 'hi-IN';

    try {
      const result = await matchingService.processAdmissionEnquiry(speechResult, {
        channel: 'phone',
        language: lang,
        callerNumber: masked,
        isPhoneCall: true
      });

      if (result.handoff) {
        response.say({
          voice: isHindi ? this.ttsVoiceHi : this.ttsVoiceEn,
          language: lang
        }, result.answer);
        response.dial(config.handoff.phone);
        return response.toString();
      }

      const promptNext = isHindi
        ? 'क्या मैं आपकी किसी और चीज़ में मदद कर सकता हूँ?'
        : 'Is there anything else I can help you with?';

      const fullAnswer = `${result.answer} ${promptNext}`;

      const gather = response.gather({
        input: 'speech',
        action: '/incoming-call/gather',
        method: 'POST',
        language: isHindi ? 'hi-IN' : 'en-IN',
        speechTimeout: 'auto'
      });

      gather.say({
        voice: isHindi ? this.ttsVoiceHi : this.ttsVoiceEn,
        language: lang
      }, fullAnswer);

      // Fallback if caller hangs up or stays quiet
      response.say({
        voice: this.ttsVoiceEn,
        language: 'en-IN'
      }, 'Thank you for calling MMMUT Admission Helpline. Goodbye.');
      response.hangup();

      return response.toString();

    } catch (err) {
      logger.error('[TELEPHONY] Gather error:', err.message);
      response.say('An error occurred. Connecting to admission helpline staff.');
      response.dial(config.handoff.phone);
      return response.toString();
    }
  }

  /**
   * Helper to transfer active call to human helpline.
   */
  async transferToStaff(callerNumber = 'Unknown', reason = 'Handoff requested') {
    const staffPhone = config.handoff.phone;
    logger.info(`[TELEPHONY] Transferring caller (${maskPhoneNumber(callerNumber)}) to helpline (${staffPhone}). Reason: ${reason}`);
    return {
      success: true,
      provider: this.provider,
      status: 'forwarded',
      targetPhone: staffPhone,
      timestamp: new Date().toISOString()
    };
  }
}

export const telephonyService = new TelephonyService();
export default telephonyService;
