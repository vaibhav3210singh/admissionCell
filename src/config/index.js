import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');

const rawDbUrl = (process.env.DATABASE_URL || '').trim();
const detectedDbType = rawDbUrl.startsWith('postgres://') || rawDbUrl.startsWith('postgresql://')
  ? 'postgres'
  : (process.env.DATABASE_TYPE || 'sqlite').toLowerCase();

/**
 * Centralized, type-safe configuration object.
 * Reads environment variables from process.env and provides sensible defaults.
 */
export const config = Object.freeze({
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production'
  },
  matching: {
    similarityThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD ?? '0.86')
  },
  embedding: {
    provider: (process.env.EMBEDDING_PROVIDER || 'local').toLowerCase(), // 'local' | 'openai' | 'gemini'
    model: process.env.EMBEDDING_MODEL || 'Xenova/multilingual-e5-small',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    geminiApiKey: process.env.GEMINI_API_KEY || ''
  },
  llm: {
    enabled: process.env.LLM_ENABLED === 'true' || process.env.LLM_ENABLED === '1',
    provider: (process.env.LLM_PROVIDER || 'gemini').toLowerCase(), // 'gemini' | 'openai' | 'claude'
    model: process.env.LLM_MODEL || 'gemini-3.5-flash-lite',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '4000', 10)
  },
  database: {
    type: detectedDbType, // 'sqlite' | 'postgres'
    url: rawDbUrl,
    sqlitePath: path.resolve(rootDir, 'data', 'admissions.db'),
    faqDataPath: path.resolve(rootDir, process.env.FAQ_DATA_PATH || './faq.json')
  },
  telephony: {
    provider: (process.env.TELEPHONY_PROVIDER || 'mock').toLowerCase(), // 'mock' | 'twilio' | 'exotel'
    accountSid: process.env.TELEPHONY_ACCOUNT_SID || '',
    authToken: process.env.TELEPHONY_AUTH_TOKEN || '',
    phoneNumber: process.env.TELEPHONY_PHONE_NUMBER || ''
  },
  handoff: {
    phone: process.env.HANDOFF_PHONE || '+91-551-2273901 / 2273902',
    email: process.env.HANDOFF_EMAIL || 'admission@mmmut.ac.in',
    hours: process.env.HANDOFF_HOURS || 'Mon - Sat (10:00 AM - 5:00 PM)',
    message: "Thank you for contacting admission support. I couldn't find a confident answer to your question in our FAQ. We will connect you to our admission staff shortly for personal assistance."
  },
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'AdminSecure2026!Pass',
    apiKey: process.env.ADMIN_API_KEY || 'admin_dev_secret_key_2026',
    sessionSecret: process.env.ADMIN_SESSION_SECRET || 'admin_jwt_session_secret_key_random_2026',
    sessionDurationMs: 8 * 60 * 60 * 1000 // 8 hours
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200', 10)
  },
  paths: {
    root: rootDir,
    public: path.resolve(rootDir, 'public'),
    data: path.resolve(rootDir, 'data')
  }
});

export default config;
