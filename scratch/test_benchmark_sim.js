import fs from 'fs';
import { pipeline } from '@xenova/transformers';

async function testBenchmarkWithNewFAQ() {
  const faqs = JSON.parse(fs.readFileSync('./faq.json', 'utf8'));
  const testQuestions = JSON.parse(fs.readFileSync('./testQuestions.json', 'utf8'));

  // Test adding the Hindi scholarship FAQ
  const candidateFaqs = [
    ...faqs,
    {
      question: "क्या विश्वविद्यालय में छात्रों को छात्रवृत्ति मिलती है?",
      answer: "विश्वविद्यालय और सरकारी नियमों के अनुसार पात्र छात्रों के लिए विभिन्न छात्रवृत्तियां उपलब्ध हैं।"
    }
  ];

  console.log('Testing with', candidateFaqs.length, 'FAQs...');
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');

  const faqEmbeddings = [];
  for (const f of candidateFaqs) {
    const emb = await extractor(`passage: ${f.question}`, { pooling: 'mean', normalize: true });
    faqEmbeddings.push({ question: f.question, embedding: emb.data });
  }

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  const threshold = 0.86;
  let g1Pass = 0, g2Pass = 0, g3Pass = 0;

  for (const q of testQuestions) {
    const qEmb = await extractor(`query: ${q.question}`, { pooling: 'mean', normalize: true });
    let maxSim = -1;
    let bestQ = '';
    for (const f of faqEmbeddings) {
      const sim = dot(qEmb.data, f.embedding);
      if (sim > maxSim) {
        maxSim = sim;
        bestQ = f.question;
      }
    }

    const isAnswered = maxSim >= threshold;
    const isCorrect = (q.expectedBehavior === 'Answered') === isAnswered;

    if (q.group.includes('Group 1') && isCorrect) g1Pass++;
    if (q.group.includes('Group 2') && isCorrect) g2Pass++;
    if (q.group.includes('Group 3') && isCorrect) g3Pass++;
  }

  console.log(`G1 (In FAQ): ${g1Pass}/20`);
  console.log(`G2 (Unrelated): ${g2Pass}/10`);
  console.log(`G3 (Not in FAQ): ${g3Pass}/10`);
  console.log(`Total: ${g1Pass + g2Pass + g3Pass}/40 (${((g1Pass + g2Pass + g3Pass) / 40 * 100).toFixed(1)}%)`);
}

testBenchmarkWithNewFAQ().catch(console.error);
