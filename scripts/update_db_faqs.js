import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import databaseService from '../src/services/databaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const faqPath = path.join(rootDir, 'faq.json');

async function syncDb() {
  await databaseService.initialize();
  const faqs = JSON.parse(fs.readFileSync(faqPath, 'utf8'));
  console.log(`Syncing ${faqs.length} FAQs to database...`);

  for (const item of faqs) {
    if (databaseService.type === 'sqlite') {
      databaseService.sqliteDb.prepare(`
        UPDATE faqs
        SET question_hi = ?, answer_en_spoken = ?, answer_hi_spoken = ?, review_status = 'draft'
        WHERE question = ?
      `).run(item.question_hi, item.answer_en_spoken, item.answer_hi_spoken, item.question);
    }
  }

  const sample = await databaseService.executeQuery('SELECT id, question, question_hi, review_status FROM faqs LIMIT 3');
  console.log('Sample rows from database:', sample);
  console.log('✅ Database sync complete!');
  process.exit(0);
}

syncDb().catch(err => {
  console.error(err);
  process.exit(1);
});
