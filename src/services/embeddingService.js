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
    
    let vectorData;
    if (provider === 'local') {
      const passageInput = `passage: ${item.question}`;
      const output = await extractor(passageInput, { pooling: 'mean', normalize: true });
      vectorData = output.data;
    } else {
      vectorData = new Float32Array(384).fill(0.1);
    }

    newEmbeddings.push({
      id: item.id,
      question: item.question,
      answer: item.answer,
      embedding: vectorData
    });

    if ((i + 1) % 25 === 0 || i + 1 === faqs.length) {
      process.stdout.write(`  -> Embedded ${i + 1}/${faqs.length} FAQs\r`);
    }
  }

  // Atomically swap the cached embeddings
  cachedFaqsWithEmbeddings = newEmbeddings;

  // Sync to faq.json on disk to keep local backup current
  try {
    const cleanFaqs = faqs.map(f => ({ question: f.question, answer: f.answer }));
    fs.writeFileSync(config.database.faqDataPath, JSON.stringify(cleanFaqs, null, 2), 'utf-8');
  } catch (err) {
    logger.warn('Failed to update faq.json on disk:', err.message);
  }

  logger.info(`\nEmbeddings loaded: ${cachedFaqsWithEmbeddings.length} FAQs in ${((Date.now() - embedStartTime) / 1000).toFixed(2)}s.`);
  return cachedFaqsWithEmbeddings.length;
}

/**
 * Finds the closest matching FAQ for an input question using semantic cosine similarity.
 * @param {string} userQuery
 * @returns {Promise<{ bestMatch: { id?: number, question: string, answer: string }, similarity: number }>}
 */
export async function findBestMatchingFAQ(userQuery) {
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

  let bestMatch = null;
  let highestSimilarity = -1;

  for (const item of cachedFaqsWithEmbeddings) {
    const similarity = computeCosineSimilarity(queryEmbedding, item.embedding);
    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      bestMatch = {
        id: item.id,
        question: item.question,
        answer: item.answer
      };
    }
  }

  return {
    bestMatch,
    similarity: highestSimilarity
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
  findBestMatchingFAQ,
  getFaqCount,
  getEmbeddingStatus
};
