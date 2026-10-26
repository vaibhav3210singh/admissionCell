/**
 * Verification Script for Auto-Deletion of Old Callbacks (> 30 days)
 */

import { initializeServices } from '../src/app.js';
import databaseService from '../src/services/databaseService.js';
import config from '../src/config/index.js';

async function verifyRetentionPurge() {
  console.log('================================================================');
  console.log('         CALLBACK RETENTION AUTO-PURGE VERIFICATION             ');
  console.log('================================================================');
  console.log(`Configured Retention Days : ${config.callbacks.retentionDays} days`);
  console.log('----------------------------------------------------------------\n');

  await initializeServices();

  // 1. Insert a simulated expired callback request created 35 days ago
  console.log('[STEP 1] Inserting simulated 35-day-old callback request...');
  const expiredInsert = await databaseService.executeQuery(`
    INSERT INTO callback_requests (
      caller_phone_encrypted, caller_phone_masked, question_text, language, reason, status, created_at
    ) VALUES (
      'simulated_expired_ciphertext', '***-***-9999', 'Old enquiry from 35 days ago', 'en-IN', 'simulated_test', 'pending', datetime('now', '-35 days')
    )
  `);
  const expiredId = expiredInsert.lastInsertRowid;
  console.log(`         Inserted expired record with ID: #${expiredId}`);

  // 2. Insert a fresh callback request created today (0 days ago)
  console.log('\n[STEP 2] Inserting simulated fresh callback request created today...');
  const freshInsert = await databaseService.executeQuery(`
    INSERT INTO callback_requests (
      caller_phone_encrypted, caller_phone_masked, question_text, language, reason, status, created_at
    ) VALUES (
      'simulated_fresh_ciphertext', '***-***-1111', 'Fresh enquiry from today', 'en-IN', 'simulated_test', 'pending', datetime('now')
    )
  `);
  const freshId = freshInsert.lastInsertRowid;
  console.log(`         Inserted fresh record with ID: #${freshId}`);

  // 3. Verify both records exist before purge
  const checkBefore = await databaseService.executeQuery(
    'SELECT id, caller_phone_masked, created_at FROM callback_requests WHERE id IN (?, ?)',
    [expiredId, freshId]
  );
  console.log('\n[STEP 3] Records present before cleanup:', checkBefore.map(r => `#${r.id} (${r.caller_phone_masked})`).join(', '));

  // 4. Trigger the retention cleanup routine
  console.log('\n[STEP 4] Executing databaseService.cleanupOldCallbacks(30)...');
  await databaseService.cleanupOldCallbacks(30);

  // 5. Verify outcome
  const checkAfter = await databaseService.executeQuery(
    'SELECT id, caller_phone_masked, created_at FROM callback_requests WHERE id IN (?, ?)',
    [expiredId, freshId]
  );
  
  const expiredStillExists = checkAfter.some(r => r.id === expiredId);
  const freshStillExists = checkAfter.some(r => r.id === freshId);

  console.log('\n[STEP 5] Verification Results:');
  console.log(`         - Expired Record (#${expiredId}, 35 days old) : ${expiredStillExists ? '❌ STILL EXISTS (Failed)' : '✅ DELETED SUCCESSFULLY'}`);
  console.log(`         - Fresh Record (#${freshId}, created today)    : ${freshStillExists ? '✅ RETAINED INTACT' : '❌ WRONGLY DELETED'}`);

  if (expiredStillExists || !freshStillExists) {
    throw new Error('Retention auto-delete logic failed verification!');
  }

  // Cleanup the test fresh record
  await databaseService.executeQuery('DELETE FROM callback_requests WHERE id = ?', [freshId]);

  console.log('\n================================================================');
  console.log('✅ RETENTION PURGE VERIFIED: Records > 30 days are automatically deleted!');
  console.log('================================================================\n');

  process.exit(0);
}

verifyRetentionPurge().catch(err => {
  console.error('[PURGE TEST FAILED]:', err);
  process.exit(1);
});
