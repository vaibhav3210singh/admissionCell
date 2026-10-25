import config from '../config/index.js';
import logger from '../utils/logger.js';

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
  }

  /**
   * Synthesizes a natural, phone-friendly spoken answer based strictly on top FAQ matches.
   * 
   * Strict Rules enforced:
   * 1. Uses ONLY provided FAQ entries (never hallucinate fees, dates, rules).
   * 2. Replies in caller's language (English, Hindi, Hinglish).
   * 3. Under 40 words, friendly spoken phone style.
   * 4. Returns EXACTLY 'NOT_FOUND' if the FAQ entries do not truly answer the query.
   * 5. For two-part questions where only one is covered, answers the covered part and notes staff will handle the rest.
   * 
   * @param {Object} params
   * @param {string} params.question - The caller's question text.
   * @param {Array<{ question: string, answer: string }>} params.faqEntries - Up to 3 candidate FAQ entries.
   * @param {string} [params.language] - Optional language code (e.g. 'hi-IN' or 'en-IN').
   * @returns {Promise<{ success: boolean, isNotFound: boolean, answer: string|null, provider: string, latencyMs: number }>}
   */
  async generateAnswer({ question, faqEntries = [], language = 'en-IN' }) {
    const startTime = Date.now();

    if (!question || typeof question !== 'string' || !question.trim()) {
      return { success: false, isNotFound: false, answer: null, latencyMs: 0, reason: 'empty_question' };
    }

    if (!faqEntries || faqEntries.length === 0) {
      return { success: true, isNotFound: true, answer: null, latencyMs: 0, reason: 'no_faqs_provided' };
    }

    // System prompt with university helpline phone rules
    const systemInstruction = 
`You are an AI Admission Helpline Assistant for MMMUT University answering phone calls.
Follow these rules strictly:
1. Answer using ONLY the provided FAQ entries. Never assume, extrapolate, or invent fees, dates, percentages, or eligibility rules.
2. Answer in the same language as the caller (English, Hindi, or Hinglish).
3. Keep the answer under 40 words, in a clear, friendly, natural spoken style suitable for a phone call.
4. If the provided FAQ entries do NOT actually answer the caller's specific question, reply with EXACTLY: NOT_FOUND
5. If the caller asks a multi-part question and only one part is covered in the FAQ, answer that covered part and explicitly state that the remaining part will be handled by admission staff.`;

    // Only send the question text and FAQ entries - nothing else
    const faqContext = faqEntries.map((item, idx) => 
      `[FAQ ${idx + 1}]\nQuestion: ${item.question}\nAnswer: ${item.answer}`
    ).join('\n\n');

    const userPrompt = 
`Provided FAQ Entries:
${faqContext}

Caller Question: "${question.trim()}"

Direct Spoken Response:`;

    try {
      let rawAnswer = null;

      if (this.provider === 'gemini') {
        rawAnswer = await this.callGemini(systemInstruction, userPrompt);
      } else if (this.provider === 'openai') {
        rawAnswer = await this.callOpenAI(systemInstruction, userPrompt);
      } else if (this.provider === 'claude') {
        rawAnswer = await this.callClaude(systemInstruction, userPrompt);
      } else {
        logger.warn(`Unsupported LLM provider '${this.provider}', skipping LLM synthesis.`);
        return { success: false, isNotFound: false, answer: null, latencyMs: Date.now() - startTime, reason: 'unsupported_provider' };
      }

      const latencyMs = Date.now() - startTime;
      const cleanAnswer = (rawAnswer || '').trim();

      // Check if LLM determined the FAQ does not answer the question
      const isNotFound = cleanAnswer.toUpperCase() === 'NOT_FOUND' || 
                         cleanAnswer.toUpperCase().startsWith('NOT_FOUND') ||
                         cleanAnswer.includes('NOT_FOUND');

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
        logger.warn(`[LLM] Request timed out after ${this.timeoutMs}ms. Falling back to direct FAQ answer.`);
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
  async callGemini(systemInstruction, userPrompt) {
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
      signal: AbortSignal.timeout(this.timeoutMs)
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
  async callOpenAI(systemInstruction, userPrompt) {
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
      signal: AbortSignal.timeout(this.timeoutMs)
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
  async callClaude(systemInstruction, userPrompt) {
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
      signal: AbortSignal.timeout(this.timeoutMs)
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
