import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import databaseService from '../src/services/databaseService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.LLM_MODEL || 'gemini-3.5-flash-lite';
const faqPath = path.join(rootDir, 'faq.json');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateBatch(items, batchIndex) {
  const prompt = `You are a bilingual admission desk translator and spoken-voice adapter for MMMUT (Madan Mohan Malaviya University of Technology).
Given these FAQ items, for EACH item produce:
1. "question_hi": Natural, faithful Hindi translation of the question in Devanagari script.
2. "answer_en_spoken": Short, conversational English spoken answer for a phone call (1-2 sentences, under 30 words, strictly factual based ONLY on the provided answer, no invented numbers/dates/fees/rules).
3. "answer_hi_spoken": Short, conversational Hindi spoken answer in Devanagari script for a phone call (1-2 sentences, under 30 words, natural polite Hindi, grammatically sound with correct anusvara/chandrabindu, ending with a danda ।, strictly based ONLY on the provided answer, no invented facts).

Return ONLY a valid JSON array of objects matching:
[{ "index": <number>, "question_hi": "...", "answer_en_spoken": "...", "answer_hi_spoken": "..." }]

Items:
${JSON.stringify(items.map(it => ({ index: it.index, question: it.question, answer: it.answer })), null, 2)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }

      const data = await res.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      const parsed = JSON.parse(content);
      return parsed;
    } catch (err) {
      console.warn(`[Batch ${batchIndex}] Attempt ${attempt} failed: ${err.message}. Retrying in 4s...`);
      await sleep(4000);
    }
  }
  throw new Error(`Batch ${batchIndex} failed after 3 attempts`);
}

async function run() {
  console.log('--- Generating Bilingual Draft FAQs for 100 Entries ---');
  const faqs = JSON.parse(fs.readFileSync(faqPath, 'utf8'));
  console.log(`Loaded ${faqs.length} FAQs from ${faqPath}`);

  const indexedFaqs = faqs.map((f, i) => ({ ...f, index: i }));
  const batchSize = 20;
  const allResults = [];

  for (let i = 0; i < indexedFaqs.length; i += batchSize) {
    const chunk = indexedFaqs.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    console.log(`Processing batch ${batchNum}/${Math.ceil(indexedFaqs.length / batchSize)} (items ${i + 1} to ${i + chunk.length})...`);
    
    const translated = await translateBatch(chunk, batchNum);
    allResults.push(...translated);
    
    if (i + batchSize < indexedFaqs.length) {
      console.log('Sleeping 3 seconds to stay well below API rate limits...');
      await sleep(3000);
    }
  }

  // Merge into FAQs array
  const resultMap = new Map(allResults.map(r => [r.index, r]));
  const updatedFaqs = indexedFaqs.map(f => {
    const trans = resultMap.get(f.index);
    return {
      question: f.question,
      answer: f.answer,
      question_hi: trans?.question_hi || f.question_hi || '',
      answer_en_spoken: trans?.answer_en_spoken || f.answer_en_spoken || '',
      answer_hi_spoken: trans?.answer_hi_spoken || f.answer_hi_spoken || '',
      review_status: 'draft'
    };
  });

  // 1. Save to faq.json
  fs.writeFileSync(faqPath, JSON.stringify(updatedFaqs, null, 2), 'utf8');
  console.log(`✅ Saved ${updatedFaqs.length} bilingual entries to ${faqPath}`);

  // 2. Update SQLite Database
  await databaseService.initialize();
  console.log('Updating SQLite database entries with draft bilingual data...');
  for (const item of updatedFaqs) {
    if (databaseService.type === 'sqlite') {
      databaseService.sqliteDb.prepare(`
        UPDATE faqs
        SET question_hi = ?, answer_en_spoken = ?, answer_hi_spoken = ?, review_status = 'draft'
        WHERE question = ?
      `).run(item.question_hi, item.answer_en_spoken, item.answer_hi_spoken, item.question);
    }
  }
  console.log('✅ SQLite faqs table updated with bilingual drafts and review_status = "draft"');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error during bilingual FAQ generation:', err);
  process.exit(1);
});
