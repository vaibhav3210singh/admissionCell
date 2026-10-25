import config from '../config/index.js';
import { findTopMatchingFAQs, getFaqCount } from './embeddingService.js';
import llmService from './llmService.js';
import databaseService from './databaseService.js';
import telephonyService from './telephonyService.js';
import logger from '../utils/logger.js';

/**
 * Unified Admission Matching Service
 * Single source of truth for enquiry resolution across all channels:
 * - Web Frontend (/ask)
 * - Automated Benchmark / Test Suite (test-threshold.js)
 * - Admin Inspection Tools
 * - Future Inbound Telephony / IVR Phone Calls
 */
class MatchingService {
  constructor() {
    this.threshold = config.matching.similarityThreshold;
    this.handoffMessage = config.handoff.message;
  }

  /**
   * Processes an incoming admission question and returns the answer or handoff verdict.
   * Flow:
   * 1. Retrieve top 3 FAQ matches via semantic vector search.
   * 2. If best similarity is below threshold -> immediate handoff to human staff.
   * 3. If similarity is above threshold:
   *    - If LLM_ENABLED is true: sends caller question & top 3 FAQs to LLM.
   *    - If LLM replies NOT_FOUND -> treat as handoff (e.g. false-positive semantic match).
   *    - If LLM answers -> return spoken phone-friendly response in caller's language.
   *    - If LLM times out (4s) or fails -> seamlessly fall back to direct FAQ answer.
   * 4. Log enquiry & LLM usage to database.
   * 
   * @param {string} userQuery
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async processAdmissionEnquiry(userQuery, options = {}) {
    if (!userQuery || typeof userQuery !== 'string' || !userQuery.trim()) {
      throw new Error('User query is required and must be a non-empty string.');
    }

    const trimmedQuery = userQuery.trim();
    const source = options.channel || options.source || 'web'; // 'web' | 'phone' | 'test' | 'admin'
    const customThreshold = options.threshold !== undefined ? options.threshold : this.threshold;
    
    // Auto-detect Hindi script if not provided
    const language = options.language || (/[\u0900-\u097F]/.test(trimmedQuery) ? 'hi-IN' : 'en-IN');

    const totalStartTime = Date.now();
    let matchingMs = 0;
    let llmMs = 0;

    // 1. Semantic vector search: retrieve top 3 candidate FAQs
    const matchStart = Date.now();
    const topMatches = await findTopMatchingFAQs(trimmedQuery, 3);
    matchingMs = Date.now() - matchStart;
    const bestMatch = topMatches[0] || null;
    const scoreFormatted = bestMatch ? Number(bestMatch.similarity.toFixed(4)) : 0;
    const baseThreshold = customThreshold;
    const highConfidenceThreshold = config.matching.highConfidenceThreshold || 0.90;

    const isPhone = source === 'phone' || Boolean(options.isPhoneCall);
    const phoneHandoffMessage = language === 'hi-IN'
      ? 'कृपया लाइन पर बने रहें, मैं आपको हमारे प्रवेश सहायता केंद्र के कर्मचारी से जोड़ रहा हूँ।'
      : 'Please hold while I connect you to our admission staff for personal assistance.';

    let finalAnswer = isPhone ? phoneHandoffMessage : this.handoffMessage;
    let handoff = true;
    let llmUsed = false;
    let llmVerdict = null;
    let tier = 'low'; // 'low' (< 0.86) | 'borderline' (0.86 to 0.90) | 'high' (>= 0.90)
    let decisionReason = '';

    // Check if LLM answer synthesis is enabled
    const isLlmEnabled = options.llmEnabled !== undefined 
      ? Boolean(options.llmEnabled) 
      : Boolean(config.llm.enabled);

    // =========================================================================
    // 3-TIER SAFE MATCHING & ROUTING ARCHITECTURE
    // =========================================================================
    if (!bestMatch || scoreFormatted < baseThreshold) {
      // -----------------------------------------------------------------------
      // TIER 1: LOW CONFIDENCE (< 0.86) -> Immediate Staff Handoff (No LLM call)
      // -----------------------------------------------------------------------
      tier = 'low';
      handoff = true;
      finalAnswer = isPhone ? phoneHandoffMessage : this.handoffMessage;
      llmUsed = false;
      llmVerdict = 'BELOW_THRESHOLD';
      decisionReason = `Below threshold (${scoreFormatted} < ${baseThreshold})`;

    } else if (scoreFormatted >= highConfidenceThreshold) {
      // -----------------------------------------------------------------------
      // TIER 3: HIGH CONFIDENCE (>= 0.90) -> Direct FAQ / Spoken Answer (No LLM!)
      // Instant execution (~15ms), zero LLM token cost, zero timeout risk.
      // -----------------------------------------------------------------------
      tier = 'high';
      handoff = false;
      llmUsed = false;
      llmVerdict = 'HIGH_CONFIDENCE_DIRECT';
      decisionReason = `High confidence match (${scoreFormatted} >= ${highConfidenceThreshold})`;

      if (isPhone) {
        // On phone calls: use pre-composed concise spoken answers if available
        if (language === 'hi-IN' && bestMatch.answer_hi_spoken) {
          finalAnswer = bestMatch.answer_hi_spoken;
        } else if (language === 'en-IN' && bestMatch.answer_en_spoken) {
          finalAnswer = bestMatch.answer_en_spoken;
        } else {
          finalAnswer = bestMatch.answer;
        }
      } else {
        // Web assistant: return official full FAQ answer
        finalAnswer = bestMatch.answer;
      }

    } else {
      // -----------------------------------------------------------------------
      // TIER 2: BORDERLINE (0.86 <= score < 0.90) -> LLM Verification Required
      // -----------------------------------------------------------------------
      tier = 'borderline';

      if (isLlmEnabled && config.llm.geminiApiKey) {
        const candidateFaqs = topMatches.map(m => ({ question: m.question, answer: m.answer }));
        const llmResult = await llmService.generateAnswer({
          question: trimmedQuery,
          faqEntries: candidateFaqs,
          language,
          isPhoneCall: isPhone
        });
        llmMs = llmResult.latencyMs || 0;

        if (llmResult.success && llmResult.isNotFound) {
          // LLM verified that candidates do NOT answer the query
          handoff = true;
          finalAnswer = isPhone ? phoneHandoffMessage : this.handoffMessage;
          llmUsed = true;
          llmVerdict = 'NOT_FOUND';
          decisionReason = `Borderline match (${scoreFormatted}) rejected by LLM: NOT_FOUND`;
        } else if (llmResult.success && llmResult.answer) {
          // LLM successfully verified and synthesized spoken answer
          handoff = false;
          finalAnswer = llmResult.answer;
          llmUsed = true;
          llmVerdict = 'ANSWERED';
          decisionReason = `Borderline match (${scoreFormatted}) verified by LLM synthesis`;
        } else {
          // SAFE FALLBACK RULE: If LLM fails or times out on borderline, HAND OFF to staff!
          // NEVER guess raw FAQ on borderline matches without LLM confirmation.
          logger.warn(`[MATCHING] Borderline match (${scoreFormatted}) failed LLM verification (${llmResult.outcome || 'timeout'}). Triggering safe staff handoff.`);
          handoff = true;
          finalAnswer = isPhone ? phoneHandoffMessage : this.handoffMessage;
          llmUsed = true;
          llmVerdict = llmResult.outcome || 'BORDERLINE_TIMEOUT_HANDOFF';
          decisionReason = `Borderline match (${scoreFormatted}) but LLM ${llmResult.outcome || 'timed out'} -> safe staff handoff`;
        }
      } else {
        // No LLM configured to verify borderline query -> safe staff handoff
        handoff = true;
        finalAnswer = isPhone ? phoneHandoffMessage : this.handoffMessage;
        llmUsed = false;
        llmVerdict = 'LLM_DISABLED_BORDERLINE_HANDOFF';
        decisionReason = `Borderline match (${scoreFormatted}) without LLM verification -> safe staff handoff`;
      }
    }

    // 3. Telephony routing trigger if handoff occurs on phone channel
    if (handoff && source === 'phone') {
      await telephonyService.transferToStaff(
        options.callerNumber || 'Unknown Caller',
        `Similarity: ${scoreFormatted}, Tier: ${tier}, Reason: ${decisionReason}`
      );
    }

    // 4. Construct uniform result
    const result = {
      answer: finalAnswer,
      handoff,
      similarity: scoreFormatted,
      threshold: customThreshold,
      highConfidenceThreshold,
      tier,
      decisionReason,
      matchedQuestion: bestMatch ? bestMatch.question : null,
      topMatches: topMatches.map(m => ({
        id: m.id,
        question: m.question,
        similarity: Number(m.similarity.toFixed(4))
      })),
      llmUsed,
      llmVerdict,
      timings: {
        matchingMs,
        llmMs,
        totalMs: Date.now() - totalStartTime
      },
      metadata: {
        channel: source,
        language,
        timestamp: new Date().toISOString(),
        faqCount: getFaqCount(),
        llmEnabled: isLlmEnabled,
        llmModel: config.llm.model,
        embeddingProvider: config.embedding.provider
      }
    };

    // 5. Log enquiry to database (no sensitive PII logged)
    try {
      await databaseService.logEnquiry({
        channel: source,
        language,
        questionText: trimmedQuery,
        matchedFaq: result.matchedQuestion,
        score: scoreFormatted,
        status: result.handoff ? 'handed_off' : 'answered',
        llmUsed
      });
    } catch (dbErr) {
      logger.error('Failed to log enquiry to database:', dbErr.message);
    }

    // 6. Console logging for visibility & tuning
    if (source !== 'test-silent') {
      console.log('\n=================== [ADMISSION ENQUIRY] ===================');
      console.log(`Source Channel  : [${source.toUpperCase()}] | Language: [${language}]`);
      console.log(`User Question   : "${trimmedQuery}"`);
      console.log(`Best Matched FAQ: "${result.matchedQuestion || 'None'}"`);
      console.log(`Similarity Score: ${scoreFormatted} (Threshold: ${customThreshold})`);
      console.log(`LLM Synthesis   : ${llmUsed ? `YES (${llmVerdict})` : 'NO (Direct FAQ/Handoff)'}`);
      console.log(`Handoff Trigger : ${result.handoff ? 'YES (Handing off to staff)' : 'NO (Returning Answer)'}`);
      console.log('===========================================================\n');
    }

    return result;
  }

  /**
   * Returns current service configuration & status.
   */
  getStatus() {
    return {
      threshold: this.threshold,
      handoffPhone: config.handoff.phone,
      handoffEmail: config.handoff.email,
      totalFaqsLoaded: getFaqCount()
    };
  }
}

export const matchingService = new MatchingService();
export default matchingService;
