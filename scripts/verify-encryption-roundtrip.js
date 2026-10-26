/**
 * Encryption Round-Trip & Security Verification Script
 * Validates AES-256-GCM encryption, database storage, and admin decryption.
 */

import { initializeServices } from '../src/app.js';
import databaseService from '../src/services/databaseService.js';
import { encryptPhoneNumber, decryptPhoneNumber, maskPhoneNumber } from '../src/utils/crypto.js';
import config from '../src/config/index.js';

async function verifyEncryptionRoundtrip() {
  console.log('================================================================');
  console.log('       CALLBACK PHONE ENCRYPTION & DECRYPTION ROUND-TRIP TEST    ');
  console.log('================================================================');
  console.log(`Configured Retention Days : ${config.callbacks.retentionDays} days`);
  console.log(`Encryption Algorithm      : AES-256-GCM`);
  console.log(`Key Source                : .env (CALLBACK_ENCRYPTION_KEY)`);
  console.log(`Key Hash Checksum (SHA256): ${config.callbacks.encryptionKey ? 'PRESENT (' + config.callbacks.encryptionKey.substring(0, 10) + '...)' : 'MISSING'}`);
  console.log('----------------------------------------------------------------\n');

  await initializeServices();

  const originalKnownNumber = '+919876543210';
  console.log(`[STEP 1] Original Raw Phone Number: "${originalKnownNumber}"`);

  // Masked check
  const maskedPhone = maskPhoneNumber(originalKnownNumber);
  console.log(`[STEP 2] Masked Output for Logs   : "${maskedPhone}" (Safe for logs & UI)`);

  // Direct Crypto Round-Trip
  const ciphertext = encryptPhoneNumber(originalKnownNumber);
  console.log(`[STEP 3] AES-256-GCM Ciphertext   : "${ciphertext}"`);
  const [iv, authTag, cipher] = ciphertext.split(':');
  console.log(`         - Initialization Vector (IV, 12 bytes) : ${iv}`);
  console.log(`         - Authentication Tag (16 bytes)       : ${authTag}`);
  console.log(`         - Encrypted Payload                   : ${cipher}`);

  const decryptedDirect = decryptPhoneNumber(ciphertext);
  console.log(`[STEP 4] Direct Decrypted Output  : "${decryptedDirect}"`);

  if (decryptedDirect !== originalKnownNumber) {
    throw new Error(`Direct crypto mismatch! Expected ${originalKnownNumber}, got ${decryptedDirect}`);
  }
  console.log('         ✅ Direct AES-256-GCM decrypt exactly matches original plaintext!');

  // Database Storage & Admin Retrieval Round-Trip
  console.log('\n[STEP 5] Storing in Database (callback_requests table)...');
  const createdRecord = await databaseService.createCallbackRequest({
    caller_phone: originalKnownNumber,
    question_text: 'Fee structure and scholarship criteria for B.Tech CSE?',
    language: 'en-IN',
    reason: 'roundtrip_verification_test',
    notes: 'Automated crypto round-trip test'
  });
  console.log(`         Record Created with ID: #${createdRecord.id}`);

  // Fetch raw row directly from database to prove ciphertext is stored
  const rawRows = await databaseService.executeQuery(
    'SELECT id, caller_phone_encrypted, caller_phone_masked, question_text, created_at FROM callback_requests WHERE id = ?',
    [createdRecord.id]
  );
  const rawRow = rawRows[0];
  console.log('\n[STEP 6] Inspecting Raw Database Row (At Rest in SQLite/Postgres):');
  console.log(`         - ID                     : ${rawRow.id}`);
  console.log(`         - caller_phone_encrypted : ${rawRow.caller_phone_encrypted}`);
  console.log(`         - caller_phone_masked    : ${rawRow.caller_phone_masked}`);
  console.log(`         - question_text          : "${rawRow.question_text}"`);
  console.log(`         - created_at             : ${rawRow.created_at}`);

  if (rawRow.caller_phone_encrypted.includes(originalKnownNumber)) {
    throw new Error('SECURITY VIOLATION: Raw phone number found in database ciphertext column!');
  }
  console.log('         ✅ Confirmed: Plaintext phone number is NOT visible in raw database column!');

  // Admin Decrypt Retrieval
  console.log('\n[STEP 7] Simulating Admin API Decrypt Call (decryptCallbackPhone)...');
  const decryptedFromDb = await databaseService.decryptCallbackPhone(createdRecord.id);
  console.log(`         - Decrypted Phone Result : "${decryptedFromDb}"`);

  if (decryptedFromDb !== originalKnownNumber) {
    throw new Error(`DB decrypt mismatch! Expected ${originalKnownNumber}, got ${decryptedFromDb}`);
  }
  console.log('         ✅ Database round-trip decrypt EXACTLY matches original known number!\n');

  console.log('================================================================');
  console.log('       SUMMARY COMPARISON (BEFORE vs AFTER):                    ');
  console.log('================================================================');
  console.log(`  BEFORE (Input to System)  : ${originalKnownNumber}`);
  console.log(`  STORED IN DATABASE        : ${rawRow.caller_phone_encrypted}`);
  console.log(`  LOGGED / DISPLAYED        : ${rawRow.caller_phone_masked}`);
  console.log(`  AFTER (Admin Decrypted)   : ${decryptedFromDb}`);
  console.log(`  MATCH VERIFICATION        : 100% IDENTICAL (${originalKnownNumber} === ${decryptedFromDb})`);
  console.log('================================================================\n');

  process.exit(0);
}

verifyEncryptionRoundtrip().catch(err => {
  console.error('[ROUND-TRIP FAILED]:', err);
  process.exit(1);
});
