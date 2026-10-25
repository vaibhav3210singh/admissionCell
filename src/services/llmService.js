import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * Cleans up spoken text before sending to Text-to-Speech (TTS).
 * - Collapses repeated spaces and line breaks.
 * - Strips stray markdown symbols (*, #, _, `, ~, [], ()).
 * - Ensures proper Hindi danda (।) termination.
 * @param {string} text
 * @param {string} language
 * @returns {string}
 */
export function cleanSpokenText(text, language = 'en-IN') {
  if (!text || typeof text !== 'string') return '';

  // 1. Collapse newlines, tabs, and multiple spaces
  let cleaned = text
    .replace(/[\r\n\t]+/g, ' ')
    // 2. Strip stray markdown, symbols, brackets, and quotes that degrade speech synthesis
    .replace(/[*#_~`[\](){}<>\\/|+=^@$%""«»]/g, '')
    // 3. Remove stray repeated commas, colons, or dashes
    .replace(/,{2,}/g, ',')
    .replace(/-{2,}/g, '-')
    .replace(/:\s*:/g, ':')
    .replace(/\s+/g, ' ')
    .trim();

  if (language === 'hi-IN') {
    // Replace ASCII full stop with Hindi danda (।)
    cleaned = cleaned.replace(/\.\s*/g, '। ');
    // Remove whitespace preceding danda or question mark
    cleaned = cleaned.replace(/\s+([।?!])/g, '$1');
    // Collapse duplicate or consecutive dandas (e.g. "।।", "। ।")
    cleaned = cleaned.replace(/[।\s]+।/g, '।');
    // Ensure the response terminates with a proper danda or question mark
    if (!/[।?!]$/.test(cleaned)) {
      cleaned = `${cleaned}।`;
    }
  } else {
    // English punctuation normalization
    cleaned = cleaned.replace(/\s+([.?!])/g, '$1');
    cleaned = cleaned.replace(/\.{2,}/g, '.');
    if (!/[.?!]$/.test(cleaned)) {
      cleaned = `${cleaned}.`;
    }
  }

  return cleaned.replace(/\s+/g, ' ').trim();
}

/**
 * Validates script quality of generated response.
 * Detects broken, corrupted, or mixed-script tokens.
 * @param {string} text
 * @param {string} language
 * @returns {boolean}
 */
export function validateSpokenScriptQuality(text, language = 'en-IN') {
  if (!text || typeof text !== 'string' || text.trim().length === 0) return false;

  const trimmed = text.trim();

  // Reject unicode replacement characters or corrupted byte markers
  if (trimmed.includes('\uFFFD')) {
    return false;
  }

  if (language === 'hi-IN') {
    // Reject if Latin characters are glued directly to Devanagari characters (e.g. "Bटेक" or "admissionफॉर्म")
    if (/[a-zA-Z][\u0900-\u097F]|[\u0900-\u097F][a-zA-Z]/.test(trimmed)) {
      return false;
    }

    // A Hindi response must contain substantial Devanagari characters
    const devanagariCount = (trimmed.match(/[\u0900-\u097F]/g) || []).length;
    const latinCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    
    // If fewer than 5 Devanagari characters or Latin dominates a Hindi reply, reject
    if (devanagariCount < 5 || latinCount > (devanagariCount / 2)) {
      return false;
    }
  } else {
    // English response should not contain stray Devanagari characters
    if (/[\u0900-\u097F]/.test(trimmed)) {
      return false;
    }
  }

  return true;
}

/**
 * Universal LLM Service
 * Provides a unified abstraction layer for LLM answer synthesis across multiple providers
 * (Google Gemini, OpenAI, Anthropic Claude).
 * Switching providers requires ONLY environment variable changes in .env.
 */
class LLMService {
  constructor() {
    this.provider = config.llm.provider;
    this.model = config.llm.model;
    this.timeoutMs = config.llm.timeoutMs || 4000;
    this.phoneTimeoutMs = config.llm.phoneTimeoutMs || 3200;
  }

  /**
   * Synthesizes a natural, phone-friendly spoken answer based strictly on top FAQ matches.
   * 
   * Strict Rules enforced:
   * 1. Uses ONLY provided FAQ entries (never hallucinate fees, dates, rules).
   * 2. Replies in caller's language (English, Hindi, Hinglish).
   * 3. Under 28 words, friendly spoken phone style.
   * 4. Returns EXACTLY 'NOT_FOUND' if the FAQ entries do not truly answer the query.
   * 5. For two-part questions where only one is covered, answers the covered part and notes staff will handle the rest.
   * 
   * @param {Object} params
   * @param {string} params.question - The caller's question text.
   * @param {Array<{ question: string, answer: string }>} params.faqEntries - Up to 3 candidate FAQ entries.
   * @param {string} [params.language] - Optional language code (e.g. 'hi-IN' or 'en-IN').
   * @param {boolean} [params.isPhoneCall] - Whether this is an active phone call requiring spoken formatting.
   * @returns {Promise<{ success: boolean, isNotFound: boolean, answer: string|null, provider: string, latencyMs: number }>}
   */
  async generateAnswer({ question, faqEntries = [], language = 'en-IN', isPhoneCall = false }) {
    const startTime = Date.now();

    if (!question || typeof question !== 'string' || !question.trim()) {
      return { success: false, isNotFound: false, answer: null, latencyMs: 0, reason: 'empty_question' };
    }

    if (!faqEntries || faqEntries.length === 0) {
      return { success: true, isNotFound: true, answer: null, latencyMs: 0, reason: 'no_faqs_provided' };
    }

    const isPhone = Boolean(isPhoneCall);

    // Compact low-latency system prompt tailored for spoken phone calls vs web text
    const systemInstruction = isPhone
      ? `MMMUT Admission Helpline Agent. Rules:
1. Grounding: Answer strictly using provided FAQs. Never invent fees, dates, eligibility. If not in FAQs, reply EXACTLY: NOT_FOUND
2. Conciseness: Under 28 words. Short spoken sentences. No markdown, bullets, or emojis.
3. Pronunciation: Spell numbers in words ("twenty-four thousand", "पच्चीस हज़ार", "साठ प्रतिशत").
4. Hindi Vocabulary & Spelling: If caller speaks Hindi/Hinglish, reply 100% in Devanagari. Use common spoken Hindi words (दाखिला, फीस, तारीख, हॉस्टल, छात्रवृत्ति, नियम, वेबसाइट; avoid rare Sanskrit/English loanwords). Ensure correct anusvara and verb spellings (करें, हैं, नहीं, होंगे, छात्रवृत्ति, ज़रूर). NEVER mix English letters in Hindi words (write बीटेक, एमएमएमयूटी, जेईई).
5. English: If caller speaks English, reply in natural English.
6. Multi-part: If partial, answer covered part; state admission staff handles the rest.`
      : `MMMUT Admission Assistant. Strict Rules:
1. Use ONLY provided FAQ. Never invent facts. If unanswered, reply: NOT_FOUND
2. Under 35 words, friendly tone, no markdown/bullets/emojis.
3. Match caller language (English, Hindi in Devanagari, or Hinglish).
4. For partial answers, note staff will handle rest.`;

    // Only send the question text and FAQ entries - compact context
    const faqContext = faqEntries.map((item, idx) => 
      `FAQ ${idx + 1}: Q: ${item.question} | A: ${item.answer}`
    ).join('\n');

    const userPrompt = `FAQs:\n${faqContext}\n\nCaller: "${question.trim()}"\nSpoken Response:`;

    const effectiveTimeout = isPhone ? this.phoneTimeoutMs : this.timeoutMs;

    try {
      let rawAnswer = null;

      if (this.provider === 'gemini') {
        rawAnswer = await this.callGemini(systemInstruction, userPrompt, effectiveTimeout);
      } else if (this.provider === 'openai') {
        rawAnswer = await this.callOpenAI(systemInstruction, userPrompt, effectiveTimeout);
      } else if (this.provider === 'claude') {
        rawAnswer = await this.callClaude(systemInstruction, userPrompt, effectiveTimeout);
      } else {
        logger.warn(`Unsupported LLM provider '${this.provider}', skipping LLM synthesis.`);
        return { success: false, isNotFound: false, answer: null, latencyMs: Date.now() - startTime, reason: 'unsupported_provider' };
      }

      const latencyMs = Date.now() - startTime;
      let cleanAnswer = (rawAnswer || '').trim();

      // Check if LLM determined the FAQ does not answer the question
      const rawUpper = (rawAnswer || '').trim().toUpperCase();
      const isNotFound = rawUpper === 'NOT_FOUND' || 
                         rawUpper.startsWith('NOT_FOUND') || 
                         rawUpper.includes('NOT_FOUND') ||
                         rawUpper.replace(/[^A-Z]/g, '').includes('NOTFOUND');

      if (isNotFound) {
        logger.info(`[LLM] Question evaluated as NOT_FOUND (${latencyMs}ms): "${question.substring(0, 50)}..."`);
        return {
          success: true,
          isNotFound: true,
          answer: null,
          provider: this.provider,
          latencyMs
        };
      }

      // Format spoken text and apply danda / punctuation cleanup
      cleanAnswer = cleanSpokenText(cleanAnswer, language);

      // Validate script quality: reject mixed-script or corrupt tokens
      if (!validateSpokenScriptQuality(cleanAnswer, language)) {
        logger.warn(`[LLM] Reply failed script quality check (broken or mixed script detected): "${cleanAnswer.substring(0, 60)}". Falling back to FAQ answer.`);
        return {
          success: false,
          isNotFound: false,
          answer: null,
          provider: this.provider,
          latencyMs,
          reason: 'script_quality_rejected'
        };
      }

      logger.info(`[LLM] Answer synthesized successfully (${latencyMs}ms) via ${this.provider}/${this.model}`);
      return {
        success: true,
        isNotFound: false,
        answer: cleanAnswer,
        provider: this.provider,
        latencyMs
      };

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout') || err.name === 'AbortError';
      
      if (isTimeout) {
        logger.warn(`[LLM] Request timed out after ${effectiveTimeout}ms. Falling back to direct FAQ answer.`);
      } else {
        logger.warn(`[LLM] Call failed (${err.message}). Falling back to direct FAQ answer.`);
      }

      return {
        success: false,
        isNotFound: false,
        answer: null,
        provider: this.provider,
        latencyMs,
        reason: isTimeout ? 'timeout' : 'error'
      };
    }
  }

  /**
   * Calls Google Gemini REST API using native fetch and AbortSignal timeout.
   */
  async callGemini(systemInstruction, userPrompt, timeoutMs = this.timeoutMs) {
    const apiKey = config.llm.geminiApiKey;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in .env');
    }

    const modelName = this.model || 'gemini-3.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const requestBody = {
      system_instruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          parts: [{ text: userPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 140
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini API returned HTTP ${res.status}: ${errBody.substring(0, 150)}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  /**
   * Calls OpenAI Chat Completions API (for future zero-rewrite upgrade).
   */
  async callOpenAI(systemInstruction, userPrompt, timeoutMs = this.timeoutMs) {
    const apiKey = config.llm.openaiApiKey;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured in .env');
    }

    const modelName = this.model || 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 140
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI API returned HTTP ${res.status}: ${errBody.substring(0, 150)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  }

  /**
   * Calls Anthropic Claude Messages API (for future zero-rewrite upgrade).
   */
  async callClaude(systemInstruction, userPrompt, timeoutMs = this.timeoutMs) {
    const apiKey = config.llm.anthropicApiKey;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured in .env');
    }

    const modelName = this.model || 'claude-3-5-haiku-20241022';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: modelName,
        system: systemInstruction,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 140,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Claude API returned HTTP ${res.status}: ${errBody.substring(0, 150)}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text || null;
  }
}

export const llmService = new LLMService();
export default llmService;
