import config from '../config/index.js';
import { findBestMatchingFAQ, getFaqCount } from './embeddingService.js';
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

    // 1. Semantic vector search
    const { bestMatch, similarity } = await findBestMatchingFAQ(trimmedQuery);
    const scoreFormatted = Number(similarity.toFixed(4));
    const isAboveThreshold = scoreFormatted >= customThreshold;

    // 2. Telephony routing trigger if handoff occurs
    if (!isAboveThreshold && source === 'phone') {
      await telephonyService.transferToStaff(
        options.callerNumber || 'Unknown Caller',
        `Low similarity score (${scoreFormatted} < ${customThreshold})`
      );
    }

    // 3. Construct uniform result
    const result = {
      answer: isAboveThreshold ? bestMatch.answer : this.handoffMessage,
      handoff: !isAboveThreshold,
      similarity: scoreFormatted,
      threshold: customThreshold,
      matchedQuestion: bestMatch ? bestMatch.question : null,
      metadata: {
        channel: source,
        language,
        timestamp: new Date().toISOString(),
        faqCount: getFaqCount(),
        provider: config.embedding.provider,
        model: config.embedding.model
      }
    };

    // 4. Log enquiry to database (no sensitive PII logged)
    try {
      await databaseService.logEnquiry({
        channel: source,
        language,
        questionText: trimmedQuery,
        matchedFaq: result.matchedQuestion,
        score: scoreFormatted,
        status: result.handoff ? 'handed_off' : 'answered'
      });
    } catch (dbErr) {
      logger.error('Failed to log enquiry to database:', dbErr.message);
    }

    // 5. Console logging for visibility & tuning
    if (source !== 'test-silent') {
      console.log('\n=================== [ADMISSION ENQUIRY] ===================');
      console.log(`Source Channel  : [${source.toUpperCase()}] | Language: [${language}]`);
      console.log(`User Question   : "${trimmedQuery}"`);
      console.log(`Best Matched FAQ: "${result.matchedQuestion || 'None'}"`);
      console.log(`Similarity Score: ${scoreFormatted} (Threshold: ${customThreshold})`);
      console.log(`Handoff Trigger : ${result.handoff ? 'YES (Handing off to staff)' : 'NO (Returning FAQ Answer)'}`);
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
