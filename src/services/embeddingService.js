import fs from 'fs';
import { pipeline } from '@xenova/transformers';
import config from '../config/index.js';
import databaseService from './databaseService.js';
import logger from '../utils/logger.js';

let extractor = null;
let cachedFaqsWithEmbeddings = [];

/**
 * Computes cosine similarity between two normalized Float32 vectors.
 * Because the vectors are L2-normalized, cosine similarity equals the dot product.
 */
function computeCosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

/**
 * Initializes the embedding model and computes embeddings for all FAQ items.
 */
export async function initializeEmbeddingService() {
  const provider = config.embedding.provider;
  const modelName = config.embedding.model;

  logger.info(`Initializing embedding service [Provider: ${provider.toUpperCase()}, Model: ${modelName}]...`);
  const startTime = Date.now();

  if (provider === 'local') {
    // Free local onnx runtime model
    extractor = await pipeline('feature-extraction', modelName);
    logger.info(`Local embedding model loaded successfully in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
  } else if (provider === 'openai' || provider === 'gemini') {
    logger.info(`Cloud embedding provider '${provider}' configured. API key present: ${Boolean(config.embedding.openaiApiKey || config.embedding.geminiApiKey)}`);
  } else {
    throw new Error(`Unsupported EMBEDDING_PROVIDER: '${provider}'`);
  }

  return reloadEmbeddings();
}

/**
 * Reloads all FAQs from the database and updates in-memory embeddings.
 * Called on startup and automatically whenever an FAQ is added, updated, or deleted.
 */
export async function reloadEmbeddings() {
  const provider = config.embedding.provider;
  const faqs = await databaseService.loadFAQs();

  logger.info(`Re-computing embeddings for ${faqs.length} FAQ questions...`);
  const embedStartTime = Date.now();
  const newEmbeddings = [];

  for (let i = 0; i < faqs.length; i++) {
    const item = faqs[i];
    
    let vectorEn;
    let vectorHi = null;

    if (provider === 'local') {
      const passageInput = `passage: ${item.question}`;
      const output = await extractor(passageInput, { pooling: 'mean', normalize: true });
      vectorEn = output.data;

      if (item.question_hi && item.question_hi.trim()) {
        const passageHi = `passage: ${item.question_hi.trim()}`;
        const outputHi = await extractor(passageHi, { pooling: 'mean', normalize: true });
        vectorHi = outputHi.data;
      }
    } else {
      vectorEn = new Float32Array(384).fill(0.1);
      if (item.question_hi && item.question_hi.trim()) {
        vectorHi = new Float32Array(384).fill(0.1);
      }
    }

    newEmbeddings.push({
      id: item.id,
      question: item.question,
      question_hi: item.question_hi || null,
      answer: item.answer,
      answer_en_spoken: item.answer_en_spoken || null,
      answer_hi_spoken: item.answer_hi_spoken || null,
      review_status: item.review_status || 'draft',
      embeddingEn: vectorEn,
      embeddingHi: vectorHi
    });

    if ((i + 1) % 25 === 0 || i + 1 === faqs.length) {
      process.stdout.write(`  -> Embedded ${i + 1}/${faqs.length} FAQs (bilingual)\r`);
    }
  }

  // Atomically swap the cached embeddings
  cachedFaqsWithEmbeddings = newEmbeddings;

  // Sync to faq.json on disk to keep local backup current
  try {
    const cleanFaqs = faqs.map(f => ({
      question: f.question,
      answer: f.answer,
      question_hi: f.question_hi || null,
      answer_en_spoken: f.answer_en_spoken || null,
      answer_hi_spoken: f.answer_hi_spoken || null,
      review_status: f.review_status || 'draft'
    }));
    fs.writeFileSync(config.database.faqDataPath, JSON.stringify(cleanFaqs, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('Failed to update faq.json on disk:', err.message);
  }

  logger.info(`\nEmbeddings loaded: ${cachedFaqsWithEmbeddings.length} bilingual FAQs in ${((Date.now() - embedStartTime) / 1000).toFixed(2)}s.`);
  return cachedFaqsWithEmbeddings.length;
}

/**
 * Finds the top K closest matching FAQs for an input question using semantic cosine similarity.
 * Matches against both English (question) and Hindi (question_hi) embeddings.
 * @param {string} userQuery
 * @param {number} topK
 * @returns {Promise<Array<{ id?: number, question: string, question_hi?: string, answer: string, answer_en_spoken?: string, answer_hi_spoken?: string, similarity: number, matchedScript: string }>>}
 */
export async function findTopMatchingFAQs(userQuery, topK = 3) {
  if (cachedFaqsWithEmbeddings.length === 0) {
    throw new Error('Embedding service is not initialized yet.');
  }

  const provider = config.embedding.provider;
  let queryEmbedding;

  if (provider === 'local') {
    const queryInput = `query: ${userQuery.trim()}`;
    const queryOutput = await extractor(queryInput, { pooling: 'mean', normalize: true });
    queryEmbedding = queryOutput.data;
  } else {
    queryEmbedding = new Float32Array(384).fill(0.1);
  }

  const scoredFaqs = cachedFaqsWithEmbeddings.map(item => {
    const simEn = computeCosineSimilarity(queryEmbedding, item.embeddingEn);
    let bestSim = simEn;
    let matchedScript = 'en';

    if (item.embeddingHi) {
      const simHi = computeCosineSimilarity(queryEmbedding, item.embeddingHi);
      if (simHi > bestSim) {
        bestSim = simHi;
        matchedScript = 'hi';
      }
    }

    return {
      id: item.id,
      question: item.question,
      question_hi: item.question_hi,
      answer: item.answer,
      answer_en_spoken: item.answer_en_spoken,
      answer_hi_spoken: item.answer_hi_spoken,
      review_status: item.review_status,
      similarity: bestSim,
      matchedScript
    };
  });

  scoredFaqs.sort((a, b) => b.similarity - a.similarity);
  return scoredFaqs.slice(0, topK);
}

/**
 * Finds the closest matching FAQ for an input question using semantic cosine similarity.
 * @param {string} userQuery
 * @returns {Promise<{ bestMatch: Object, similarity: number }>}
 */
export async function findBestMatchingFAQ(userQuery) {
  const topMatches = await findTopMatchingFAQs(userQuery, 1);
  const best = topMatches[0] || null;
  return {
    bestMatch: best ? {
      id: best.id,
      question: best.question,
      question_hi: best.question_hi,
      answer: best.answer,
      answer_en_spoken: best.answer_en_spoken,
      answer_hi_spoken: best.answer_hi_spoken
    } : null,
    similarity: best ? best.similarity : -1
  };
}

/**
 * Returns total count of cached FAQ items.
 */
export function getFaqCount() {
  return cachedFaqsWithEmbeddings.length;
}

/**
 * Returns embedding service status.
 */
export function getEmbeddingStatus() {
  return {
    provider: config.embedding.provider,
    model: config.embedding.model,
    faqCount: cachedFaqsWithEmbeddings.length,
    isInitialized: cachedFaqsWithEmbeddings.length > 0
  };
}

export default {
  initializeEmbeddingService,
  reloadEmbeddings,
  findTopMatchingFAQs,
  findBestMatchingFAQ,
  getFaqCount,
  getEmbeddingStatus
};
