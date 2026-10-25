import 'dotenv/config';
import fs from 'fs';

const apiKey = process.env.GEMINI_API_KEY;
const modelName = process.env.LLM_MODEL || 'gemini-3.5-flash-lite';

async function test() {
  const faqs = JSON.parse(fs.readFileSync('./faq.json', 'utf8')).slice(0, 5);
  const prompt = `You are a bilingual admission desk assistant for MMMUT (Madan Mohan Malaviya University of Technology).
Given these FAQ items, for each item generate:
1. "question_hi": Faithful Hindi translation of the question in Devanagari script.
2. "answer_en_spoken": Short, conversational English spoken answer for phone calls (1-2 sentences, under 30 words, strictly factual based ONLY on the provided answer, no invented numbers/dates/fees).
3. "answer_hi_spoken": Short, conversational Hindi spoken answer in Devanagari script for phone calls (1-2 sentences, under 30 words, natural spoken Hindi, grammatically sound, ending with a danda ।, strictly based ONLY on the provided answer).

Return ONLY valid JSON array with objects matching:
[{ "index": 0, "question_hi": "...", "answer_en_spoken": "...", "answer_hi_spoken": "..." }]

Items:
${JSON.stringify(faqs.map((f, i) => ({ index: i, question: f.question, answer: f.answer })), null, 2)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const start = Date.now();
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

  const duration = Date.now() - start;
  const data = await res.json();
  console.log(`Status: ${res.status} | Latency: ${duration}ms`);
  console.log('Result:', data.candidates?.[0]?.content?.parts?.[0]?.text);
}

test();
