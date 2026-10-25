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

    // 1. Semantic vector search: retrieve top 3 candidate FAQs
    const topMatches = await findTopMatchingFAQs(trimmedQuery, 3);
    const bestMatch = topMatches[0] || null;
    const scoreFormatted = bestMatch ? Number(bestMatch.similarity.toFixed(4)) : 0;
    const isAboveThreshold = scoreFormatted >= customThreshold;

    let finalAnswer = this.handoffMessage;
    let handoff = !isAboveThreshold;
    let llmUsed = false;
    let llmVerdict = null;

    // Check if LLM answer synthesis is enabled
    const isLlmEnabled = options.llmEnabled !== undefined 
      ? Boolean(options.llmEnabled) 
      : Boolean(config.llm.enabled);

    // 2. High-confidence candidate evaluation
    if (isAboveThreshold && bestMatch) {
      if (isLlmEnabled && config.llm.geminiApiKey) {
        // Send ONLY question text and top 3 FAQ entries to the LLM
        const candidateFaqs = topMatches.map(m => ({ question: m.question, answer: m.answer }));
        const llmResult = await llmService.generateAnswer({
          question: trimmedQuery,
          faqEntries: candidateFaqs,
          language
        });

        if (llmResult.success && llmResult.isNotFound) {
          // LLM evaluated that the top FAQ entries do NOT actually answer the query
          handoff = true;
          finalAnswer = this.handoffMessage;
          llmUsed = true;
          llmVerdict = 'NOT_FOUND';
        } else if (llmResult.success && llmResult.answer) {
          // LLM successfully synthesized a phone-friendly spoken answer
          handoff = false;
          finalAnswer = llmResult.answer;
          llmUsed = true;
          llmVerdict = 'ANSWERED';
        } else {
          // LLM call failed or timed out (4s): fallback to direct FAQ answer
          logger.warn('[MATCHING] LLM synthesis unavailable/timed out. Falling back to direct FAQ answer.');
          handoff = false;
          finalAnswer = bestMatch.answer;
          llmUsed = false;
          llmVerdict = 'FALLBACK_RAW_FAQ';
        }
      } else {
        // LLM disabled: Return direct FAQ answer
        handoff = false;
        finalAnswer = bestMatch.answer;
        llmUsed = false;
        llmVerdict = 'LLM_DISABLED';
      }
    }

    // 3. Telephony routing trigger if handoff occurs on phone channel
    if (handoff && source === 'phone') {
      await telephonyService.transferToStaff(
        options.callerNumber || 'Unknown Caller',
        `Similarity: ${scoreFormatted}, LLM verdict: ${llmVerdict || 'below_threshold'}`
      );
    }

    // 4. Construct uniform result
    const result = {
      answer: finalAnswer,
      handoff,
      similarity: scoreFormatted,
      threshold: customThreshold,
      matchedQuestion: bestMatch ? bestMatch.question : null,
      topMatches: topMatches.map(m => ({
        id: m.id,
        question: m.question,
        similarity: Number(m.similarity.toFixed(4))
      })),
      llmUsed,
      llmVerdict,
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
