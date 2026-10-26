import crypto from 'crypto';
import config from '../config/index.js';

// Derive 32-byte encryption key strictly from CALLBACK_ENCRYPTION_KEY in .env
function getEncryptionKey() {
  const secret = config.callbacks?.encryptionKey || process.env.CALLBACK_ENCRYPTION_KEY;
  if (!secret || !secret.trim()) {
    throw new Error(
      'FATAL SECURITY CONFIG ERROR: CALLBACK_ENCRYPTION_KEY is missing in .env! ' +
      'A dedicated 32-byte key is strictly required to encrypt caller phone numbers at rest (AES-256-GCM). ' +
      'Generate one using: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))" and add it to .env.'
    );
  }
  return crypto.createHash('sha256').update(secret.trim()).digest();
}

/**
 * Encrypts sensitive caller phone numbers using AES-256-GCM.
 * Format: iv_hex:authTag_hex:ciphertext_hex
 * @param {string} text - Raw phone number (e.g. +919876543210)
 * @returns {string} Encrypted string
 */
export function encryptPhoneNumber(text) {
  if (!text || typeof text !== 'string') return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text.trim(), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts phone number encrypted with encryptPhoneNumber.
 * @param {string} encryptedText - iv_hex:authTag_hex:ciphertext_hex
 * @returns {string} Plaintext phone number
 */
export function decryptPhoneNumber(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string') return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      // Fallback if plaintext or older format
      return encryptedText;
    }
    const [ivHex, authTagHex, cipherHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return '***-DECRYPTION-ERROR-***';
  }
}

/**
 * Masks a phone number retaining only last 4 digits (e.g. ***-***-3210).
 * Never print or log raw unmasked phone numbers.
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

export default {
  encryptPhoneNumber,
  decryptPhoneNumber,
  maskPhoneNumber
};
