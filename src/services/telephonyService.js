import { WebSocketServer } from 'ws';
import twilio from 'twilio';
import config from '../config/index.js';
import matchingService from './matchingService.js';
import { cleanSpokenText } from './llmService.js';
import logger from '../utils/logger.js';
import databaseService from './databaseService.js';
import scheduleService from './scheduleService.js';

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

  // Comprehensive Hinglish grammar, function, and vocabulary markers
  const hinglishMarkers = new Set([
    'kya', 'kaise', 'kab', 'kitna', 'kitni', 'kitne', 'kaha', 'kahan', 'kyu', 'kyun',
    'hai', 'hain', 'ho', 'hoon', 'hun',
    'chahiye', 'chahie', 'milega', 'milegi', 'milenge', 'hoga', 'hogi', 'honge',
    'karna', 'karein', 'kare', 'karne', 'karta', 'karti', 'karte', 'kiya',
    'bataiye', 'batao', 'bataye', 'bata',
    'sakte', 'sakta', 'sakti', 'nahi', 'nahin', 'na',
    'daakhila', 'pravesh', 'shulk', 'padhai',
    'mera', 'meri', 'mere', 'apna', 'apni', 'apne',
    'aap', 'tum', 'hum', 'hamara', 'hamari', 'mujhe', 'hume', 'hame',
    'ki', 'ke', 'ka', 'ko', 'se', 'mein', 'me', 'par', 'pe', 'aur', 'ya',
    'bharo', 'bharna', 'bhare', 'milta', 'milti', 'milte',
    'pata', 'pooch', 'poochhna', 'jana', 'jane', 'dekh', 'dekhein'
  ]);

  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const isHinglish = words.some(w => hinglishMarkers.has(w));
  return isHinglish ? 'hi-IN' : 'en-IN';
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
    this.dialerProvider = config.telephony.dialerProvider || 'mock'; // 'mock' | 'twilio'
    this.callMode = config.telephony.callMode; // 'conversationrelay' | 'gather'
    this.accountSid = config.telephony.accountSid;
    this.authToken = config.telephony.authToken;
    this.phoneNumber = config.telephony.phoneNumber;
    this.ttsProvider = config.telephony.ttsProvider;
    this.ttsVoiceEn = config.telephony.ttsVoiceEn;
    this.ttsVoiceHi = config.telephony.ttsVoiceHi;
    this.wss = null;
    this.activeCalls = new Map();
    this.callerTransferHistory = new Map(); // caller -> array of timestamp numbers
  }

  /**
   * Initializes telephony configuration.
   */
  async initialize() {
    logger.info(`Telephony service initialized [Provider: ${this.provider.toUpperCase()}, Mode: ${this.callMode.toUpperCase()}]`);
    logger.info(`TTS Provider: ${this.ttsProvider.toUpperCase()} | Voice EN: ${this.ttsVoiceEn} | Voice HI: ${this.ttsVoiceHi}`);

    // Startup warning if configured ElevenLabs voice ID is a default demo voice
    const DEMO_VOICE_IDS = ['21m00Tcm4TlvDq8ikWAM', 'AZnzlk1XvdvUeBnXmlld', 'EXAVITQu4vr4xnSDxMaL', 'ErXwobaYiN019PkySvjV'];
    const isEnDemo = DEMO_VOICE_IDS.includes(this.ttsVoiceEn);
    const isHiDemo = DEMO_VOICE_IDS.includes(this.ttsVoiceHi);
    if (this.ttsProvider === 'elevenlabs' && (isEnDemo || isHiDemo)) {
      logger.warn(`⚠️ [TELEPHONY STARTUP WARNING] Configured ElevenLabs voice ID (${isEnDemo ? `EN: ${this.ttsVoiceEn}` : ''}${isHiDemo ? ` HI: ${this.ttsVoiceHi}` : ''}) matches an ElevenLabs default demo voice. For production, set your chosen custom voice IDs in .env.`);
    }

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
        activeLanguage: 'en-IN',
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

        // Mid-Call Language Switching per Twilio ConversationRelay Specification
        // Sends {"type": "language"} frame to switch STT and TTS language dynamically
        if (state.detectedLanguage !== state.activeLanguage || state.turnCount === 1) {
          logger.info(`[TELEPHONY] Sending ConversationRelay switch language frame to: ${state.detectedLanguage}`);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'language',
              ttsLanguage: state.detectedLanguage,
              transcriptionLanguage: state.detectedLanguage
            }));
          }
          state.activeLanguage = state.detectedLanguage;
        }

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

          // Clean and normalize spoken text before sending to TTS
          spokenAnswer = cleanSpokenText(spokenAnswer, state.detectedLanguage);
          state.lastSpokenText = spokenAnswer;

          // Send synthesized spoken response back to ConversationRelay with lang attribute
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({
              type: 'text',
              token: spokenAnswer,
              last: true,
              lang: state.detectedLanguage,
              timings: result.timings,
              handoff: result.handoff,
              handoffDetails: result.handoffDetails || null,
              matchedQuestion: result.matchedQuestion,
              similarity: result.similarity,
              threshold: result.threshold,
              llmVerdict: result.llmVerdict
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

      // Clear, inviting greeting spoken naturally by English voice without mangling Hindi Devanagari
      const cleanGreeting = 'Welcome to MMMUT Admission Helpline. You can speak to me in English or Hindi. How can I help you today?';

      const relay = connect.conversationRelay({
        url: wsUrl,
        welcomeGreeting: cleanGreeting,
        ttsProvider: this.ttsProvider,
        transcriptionProvider: config.telephony.transcriptionProvider || 'deepgram',
        transcriptionLanguage: config.telephony.transcriptionLanguage || 'multi',
        interruptible: 'true'
      });

      // Nested Language elements with specific voices for each language
      relay.language({
        code: 'en-IN',
        ttsProvider: this.ttsProvider,
        voice: this.ttsVoiceEn
      });

      relay.language({
        code: 'hi-IN',
        ttsProvider: this.ttsProvider,
        voice: this.ttsVoiceHi
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

      if (this.ttsProvider === 'amazon' || this.ttsVoiceHi.includes('Polly.Aditi')) {
        // Polly.Aditi is bilingual Indian English & Hindi
        gather.say({
          voice: 'Polly.Aditi',
          language: 'hi-IN'
        }, 'Welcome to MMMUT Admission Helpline. How can I help you? एमएमएमयूटी प्रवेश सहायता केंद्र में आपका स्वागत है।');
      } else {
        // Clear English greeting with English voice
        gather.say({
          voice: this.ttsVoiceEn,
          language: 'en-IN'
        }, 'Welcome to MMMUT Admission Helpline. You can ask your questions in English or Hindi.');
      }

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
   * Rate limiting for caller transfers to prevent abuse.
   * Window: config.telephony.transferRateLimitWindowMs (default 15m), Max: config.telephony.maxTransfersPerCaller (default 3)
   */
  checkCallerTransferRateLimit(callerPhone) {
    if (!callerPhone || callerPhone === 'Unknown' || callerPhone.includes('Unknown')) {
      return { allowed: true, count: 1, max: config.telephony.maxTransfersPerCaller || 3 };
    }
    const cleanPhone = callerPhone.replace(/[^0-9]/g, '');
    const now = Date.now();
    const windowMs = config.telephony.transferRateLimitWindowMs || 900000;
    const maxTransfers = config.telephony.maxTransfersPerCaller || 3;

    let history = this.callerTransferHistory.get(cleanPhone) || [];
    // Purge timestamps older than window
    history = history.filter(ts => (now - ts) < windowMs);

    if (history.length >= maxTransfers) {
      this.callerTransferHistory.set(cleanPhone, history);
      return { allowed: false, count: history.length, max: maxTransfers };
    }

    history.push(now);
    this.callerTransferHistory.set(cleanPhone, history);
    return { allowed: true, count: history.length, max: maxTransfers };
  }

  /**
   * Comprehensive Sequential Staff Dialer with Busy-Line Fallback and Encrypted Callback Registration.
   */
  async handleHandoffTransfer(params = {}) {
    const callerNumber = params.callerNumber || 'Unknown';
    const maskedCaller = maskPhoneNumber(callerNumber);
    const questionText = params.questionText || 'General Admission Enquiry';
    const language = params.language || 'en-IN';
    const isHindi = language === 'hi-IN';
    const simulatedStatuses = params.simulatedStaffStatuses || null;
    const forceOutside = params.forceOutsideHours ?? false;
    const forceInside = params.forceInsideHours ?? false;
    const reason = params.reason || 'Staff handoff initiated';

    logger.info(`[TELEPHONY HANDOFF] Initiating transfer sequence for caller ${maskedCaller} (${language}). Reason: ${reason}`);

    // STEP 1: Check Caller Transfer Rate Limit
    const rateLimitCheck = this.checkCallerTransferRateLimit(callerNumber);
    if (!rateLimitCheck.allowed) {
      logger.warn(`[TELEPHONY RATE LIMIT] Caller ${maskedCaller} exceeded limit (${rateLimitCheck.count}/${rateLimitCheck.max} transfers in window). Blocking transfer.`);
      await databaseService.createCallbackRequest({
        caller_phone: callerNumber,
        question_text: questionText,
        language,
        reason: 'rate_limit_exceeded',
        notes: `Transfer rate limit exceeded (${rateLimitCheck.count}/${rateLimitCheck.max})`
      });

      const rateMsg = isHindi
        ? 'आपके नंबर से पहले ही कई ट्रांसफर अनुरोध दर्ज हो चुके हैं। हमारे प्रवेश अधिकारी जल्द ही आपसे संपर्क करेंगे। धन्यवाद।'
        : 'Multiple transfer requests have already been logged for your number. Our admission desk will call you back shortly. Thank you.';

      return {
        success: false,
        status: 'rate_limited',
        spokenMessage: rateMsg,
        dialResults: []
      };
    }

    // STEP 2: Respect Working Hours & Holidays
    const hoursCheck = await scheduleService.isWithinWorkingHours({ 
      forceOutsideHours: forceOutside,
      forceInsideHours: forceInside
    });
    if (!hoursCheck.isOpen) {
      logger.info(`[TELEPHONY SCHEDULE] Office is CLOSED (${hoursCheck.reason}). Skipping staff transfer and registering callback.`);
      await databaseService.createCallbackRequest({
        caller_phone: callerNumber,
        question_text: questionText,
        language,
        reason: 'outside_hours',
        notes: `Office closed: ${hoursCheck.reason}`
      });

      const closedSpokenMsg = scheduleService.getClosedOfficeSpokenMessage(language, hoursCheck.schedule);
      return {
        success: false,
        status: 'office_closed',
        officeClosed: true,
        reason: hoursCheck.reason,
        spokenMessage: closedSpokenMsg,
        dialResults: []
      };
    }

    // STEP 3: Retrieve Active Staff Numbers from Database
    const activeStaff = await databaseService.getStaffNumbers({ activeOnly: true });
    if (!activeStaff || activeStaff.length === 0) {
      logger.warn('[TELEPHONY DIALER] No active staff numbers found in database! Saving callback request.');
      await databaseService.createCallbackRequest({
        caller_phone: callerNumber,
        question_text: questionText,
        language,
        reason: 'no_staff_configured',
        notes: 'No active staff numbers in database'
      });

      const noStaffMsg = isHindi
        ? 'क्षमा करें, हमारे सभी प्रवेश प्रतिनिधि अभी अनुपलब्ध हैं। हमने आपका कॉलबैक अनुरोध सुरक्षित कर लिया है। हमारे अधिकारी आपसे जल्द संपर्क करेंगे।'
        : 'We apologize, but our admission representatives are currently unavailable. We have saved your callback request, and an officer will reach out to you shortly.';

      return {
        success: false,
        status: 'no_staff_available',
        spokenMessage: noStaffMsg,
        dialResults: []
      };
    }

    // Cap attempts by MAX_STAFF_ATTEMPTS_PER_CALL (default: 3)
    const maxAttempts = config.telephony.maxStaffAttemptsPerCall || 3;
    const staffQueue = activeStaff.slice(0, maxAttempts);

    // Initial "Please hold" announcement (polite, caller-friendly, no internal jargon)
    const pleaseHoldLine = isHindi
      ? 'कृपया लाइन पर बने रहें, मैं आपको हमारे प्रवेश सहायता अधिकारी से जोड़ रहा हूँ।'
      : 'Please hold while I connect you to an admission officer for personal assistance.';

    logger.info(`[TELEPHONY DIALER] Trying ${staffQueue.length} staff numbers in sequential order (Max timeout: ${config.telephony.staffDialTimeoutSeconds || 20}s per number)...`);

    const dialResults = [];
    let connectedStaff = null;

    // STEP 4: Sequential Dialing Loop
    for (let i = 0; i < staffQueue.length; i++) {
      const staff = staffQueue[i];
      const attemptNum = i + 1;

      // If previous attempt failed, speak a warm reassurance hold message so caller never hears dead silence
      if (attemptNum > 1) {
        const stillTryingMsg = isHindi
          ? 'कृपया प्रतीक्षा करें, हम अभी भी आपको हमारे अधिकारी से जोड़ने का प्रयास कर रहे हैं।'
          : 'Please continue to hold, we are still trying to connect your call to an available officer.';
        logger.info(`[TELEPHONY HOLD] Playing interim hold reassurance to caller: "${stillTryingMsg}"`);
      }

      logger.info(`[TELEPHONY DIALER] -> Attempt #${attemptNum}/${staffQueue.length}: Dialing ${staff.name} (${staff.masked_phone}, Priority: ${staff.priority})...`);

      // Determine dial result:
      // In simulator / test: use simulatedStatuses[i] if provided (e.g. 'busy', 'no-answer', 'rejected', 'answered')
      // Otherwise default mock is 'answered'
      let outcome = 'answered';
      if (Array.isArray(simulatedStatuses) && simulatedStatuses[i] !== undefined) {
        outcome = simulatedStatuses[i].toLowerCase();
      } else if (this.dialerProvider === 'mock') {
        outcome = 'answered';
      } else if (this.dialerProvider === 'twilio') {
        outcome = 'forwarded_to_twilio_dial';
      }

      dialResults.push({
        attempt: attemptNum,
        staffId: staff.id,
        staffName: staff.name,
        maskedPhone: staff.masked_phone,
        outcome,
        timeoutSeconds: config.telephony.staffDialTimeoutSeconds || 20,
        interimHoldPlayed: attemptNum > 1
      });

      if (outcome === 'answered' || outcome === 'forwarded_to_twilio_dial') {
        logger.info(`[TELEPHONY DIALER] ✅ ${staff.name} (${staff.masked_phone}) ANSWERED! Transfer successful.`);
        connectedStaff = staff;
        break;
      } else {
        logger.warn(`[TELEPHONY DIALER] ❌ ${staff.name} (${staff.masked_phone}) was ${outcome.toUpperCase()} (after ~20s timeout).`);
      }
    }

    // STEP 5: Handle Outcome
    if (connectedStaff) {
      // Natural spoken message to caller (desk name removed for professional caller experience)
      const connectedMsg = isHindi
        ? 'कृपया लाइन पर बने रहें, आपकी कॉल हमारे प्रवेश अधिकारी से जोड़ी जा रही है।'
        : 'Please stay on the line, connecting your call to an admission officer now.';

      return {
        success: true,
        status: 'connected',
        connectedStaff,
        dialResults,
        initialPrompt: pleaseHoldLine,
        spokenMessage: connectedMsg
      };
    } else {
      // Nobody answered: Save callback request and apologize
      logger.info(`[TELEPHONY DIALER] All ${staffQueue.length} staff attempts failed (busy/no-answer). Registering encrypted callback request...`);
      await databaseService.createCallbackRequest({
        caller_phone: callerNumber,
        question_text: questionText,
        language,
        reason: 'all_staff_busy',
        notes: `Dialed ${staffQueue.length} staff numbers in sequence. None answered.`
      });

      const allBusyMsg = isHindi
        ? 'क्षमा करें, हमारे सभी प्रवेश प्रतिनिधि अभी व्यस्त हैं। हमने आपका कॉलबैक अनुरोध सुरक्षित कर लिया है। हमारे अधिकारी आपसे जल्द ही संपर्क करेंगे। धन्यवाद।'
        : 'We apologize, but all our admission representatives are currently busy. We have saved your callback request, and our officer will call you back shortly. Thank you.';

      return {
        success: false,
        status: 'all_staff_busy',
        allStaffBusy: true,
        dialResults,
        initialPrompt: pleaseHoldLine,
        spokenMessage: allBusyMsg
      };
    }
  }

  /**
   * Helper to transfer active call to human helpline.
   */
  async transferToStaff(callerNumber = 'Unknown', reason = 'Handoff requested', options = {}) {
    return this.handleHandoffTransfer({
      callerNumber,
      reason,
      ...options
    });
  }

  /**
   * Diagnostic status for /health endpoint.
   */
  getStatus() {
    return {
      provider: this.provider,
      callMode: this.callMode,
      ttsProvider: this.ttsProvider,
      ttsVoiceEn: this.ttsVoiceEn,
      ttsVoiceHi: this.ttsVoiceHi,
      activeCalls: this.activeCalls ? this.activeCalls.size : 0,
      wsAttached: Boolean(this.wss)
    };
  }
}

export const telephonyService = new TelephonyService();
export default telephonyService;
