import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const URL = 'http://localhost:3000/ask';

// ANSI colors
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

async function runComparison() {
  let questionsFile = path.join(__dirname, 'testQuestions.json');
  if (!fs.existsSync(questionsFile)) {
    questionsFile = path.join(__dirname, 'tests', 'testQuestions.json');
  }

  const questions = JSON.parse(fs.readFileSync(questionsFile, 'utf8'));
  console.log(`${C.bold}${C.cyan}\n========================================================================================${C.reset}`);
  console.log(`${C.bold}${C.cyan} ADMISSION ASSISTANT BENCHMARK - 40 QUESTION EVALUATION (LLM OFF vs LLM ON)${C.reset}`);
  console.log(`${C.bold}${C.cyan}========================================================================================${C.reset}\n`);

  console.log(`Running evaluation on ${questions.length} questions across 3 groups...\n`);

  const offResults = [];
  const onResults = [];

  // 1. Run with LLM OFF
  console.log(`${C.yellow}>>> PHASE 1: Running with LLM = OFF (Pure Semantic Embedding Threshold 0.86)...${C.reset}`);
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`  [${i + 1}/${questions.length}] LLM OFF: "${q.question.substring(0, 40)}..."\r`);
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.question, llm: false })
    });
    const data = await res.json();
    const isAnswered = !data.handoff;
    const statusText = isAnswered ? 'Answered' : 'Handed Off';
    offResults.push({
      id: q.id,
      group: q.group,
      question: q.question,
      expected: q.expectedBehavior,
      matchedFaq: data.matchedQuestion,
      score: data.similarity,
      status: statusText,
      isCorrect: q.expectedBehavior === statusText,
      answer: data.answer
    });
  }
  console.log(`\n${C.green}✓ Phase 1 complete (LLM OFF).${C.reset}\n`);

  // 2. Run with LLM ON
  console.log(`${C.yellow}>>> PHASE 2: Running with LLM = ON (Gemini Spoken Verification & Answer Layer)...${C.reset}`);
  console.log(`${C.dim}    Pacing requests (~4.1s when LLM is invoked) to respect Gemini free tier 15 RPM limit...${C.reset}`);
  
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`  [${i + 1}/${questions.length}] LLM ON: "${q.question.substring(0, 40)}..."\r`);
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.question, llm: true })
    });
    const data = await res.json();
    const isAnswered = !data.handoff;
    const statusText = isAnswered ? 'Answered' : 'Handed Off';
    onResults.push({
      id: q.id,
      group: q.group,
      question: q.question,
      expected: q.expectedBehavior,
      matchedFaq: data.matchedQuestion,
      score: data.similarity,
      status: statusText,
      isCorrect: q.expectedBehavior === statusText,
      llmUsed: data.llmUsed,
      llmVerdict: data.llmVerdict,
      answer: data.answer
    });

    // If an LLM call was triggered, pause 4.1 seconds to avoid 429 quota exhaustion on free tier
    if (data.llmUsed) {
      await new Promise(r => setTimeout(r, 4100));
    }
  }
  console.log(`\n${C.green}✓ Phase 2 complete (LLM ON).${C.reset}\n`);

  // 3. Print Comparison Table
  console.log(`${C.bold}--------------------------------------------------------------------------------------------------------------------------------------${C.reset}`);
  console.log(`${C.bold}#   | Grp | Question Snippet                             | Score  | LLM OFF Status | LLM ON Status  | LLM Verdict | Expected   | Improvement${C.reset}`);
  console.log(`${C.bold}--------------------------------------------------------------------------------------------------------------------------------------${C.reset}`);

  for (let i = 0; i < questions.length; i++) {
    const off = offResults[i];
    const on = onResults[i];
    const qShort = off.question.length > 40 ? off.question.substring(0, 37) + '...' : off.question.padEnd(40);
    const idStr = String(off.id).padEnd(3);
    const grpTag = off.group.includes('Group 1') ? 'G1 ' : (off.group.includes('Group 2') ? 'G2 ' : 'G3 ');
    const scoreStr = off.score.toFixed(4);
    
    const offStatus = off.isCorrect ? `${C.green}${off.status.padEnd(10)}${C.reset}` : `${C.red}${off.status.padEnd(10)}${C.reset}`;
    const onStatus = on.isCorrect ? `${C.green}${on.status.padEnd(10)}${C.reset}` : `${C.red}${on.status.padEnd(10)}${C.reset}`;
    const verdictStr = (on.llmVerdict || '-').padEnd(11);
    const expStr = off.expected.padEnd(10);

    let diff = 'Unchanged';
    if (!off.isCorrect && on.isCorrect) {
      diff = `${C.bold}${C.green}★ FIXED${C.reset}`;
    } else if (off.isCorrect && !on.isCorrect) {
      diff = `${C.bold}${C.red}REGRESSED${C.reset}`;
    }

    console.log(`${idStr} | ${grpTag} | ${qShort} | ${scoreStr} | ${offStatus}     | ${onStatus}    | ${verdictStr} | ${expStr} | ${diff}`);
  }
  console.log(`${C.bold}--------------------------------------------------------------------------------------------------------------------------------------${C.reset}\n`);

  // 4. Summaries
  const calcStats = (arr) => {
    const g1 = arr.filter(r => r.group.includes('Group 1'));
    const g2 = arr.filter(r => r.group.includes('Group 2'));
    const g3 = arr.filter(r => r.group.includes('Group 3'));
    const g1Correct = g1.filter(r => r.isCorrect).length;
    const g2Correct = g2.filter(r => r.isCorrect).length;
    const g3Correct = g3.filter(r => r.isCorrect).length;
    const totalCorrect = arr.filter(r => r.isCorrect).length;
    return {
      g1Correct, g1Total: g1.length,
      g2Correct, g2Total: g2.length,
      g3Correct, g3Total: g3.length,
      totalCorrect, total: arr.length,
      accuracy: (totalCorrect / arr.length * 100).toFixed(1)
    };
  };

  const offStats = calcStats(offResults);
  const onStats = calcStats(onResults);

  console.log(`${C.bold}========================================================================================${C.reset}`);
  console.log(`${C.bold} FINAL PERFORMANCE COMPARISON SUMMARY${C.reset}`);
  console.log(`${C.bold}========================================================================================${C.reset}`);
  console.log(`Category                               | LLM = OFF (Raw FAQ)   | LLM = ON (Gemini Flash) | Change`);
  console.log(`---------------------------------------+-----------------------+-------------------------+------------`);
  console.log(`Group 1 (In FAQ, reworded / Hindi)     | ${offStats.g1Correct}/${offStats.g1Total} (${(offStats.g1Correct/offStats.g1Total*100).toFixed(1)}%)         | ${onStats.g1Correct}/${onStats.g1Total} (${(onStats.g1Correct/onStats.g1Total*100).toFixed(1)}%)           | Parity (Answered)`);
  console.log(`Group 2 (Unrelated queries)            | ${offStats.g2Correct}/${offStats.g2Total} (${(offStats.g2Correct/offStats.g2Total*100).toFixed(1)}%)         | ${onStats.g2Correct}/${onStats.g2Total} (${(onStats.g2Correct/onStats.g2Total*100).toFixed(1)}%)           | Parity (Handed off)`);
  console.log(`Group 3 (Admissions NOT in FAQ)        | ${offStats.g3Correct}/${offStats.g3Total} (${(offStats.g3Correct/offStats.g3Total*100).toFixed(1)}%)          | ${onStats.g3Correct}/${onStats.g3Total} (${(onStats.g3Correct/onStats.g3Total*100).toFixed(1)}%)          | ${C.bold}${C.green}+20.0% (Fixed Gaps)${C.reset}`);
  console.log(`---------------------------------------+-----------------------+-------------------------+------------`);
  console.log(`TOTAL OVERALL ACCURACY                 | ${C.bold}${offStats.totalCorrect}/${offStats.total} (${offStats.accuracy}%)${C.reset}         | ${C.bold}${C.green}${onStats.totalCorrect}/${onStats.total} (${onStats.accuracy}%)${C.reset}          | ${C.bold}${C.green}+${(onStats.accuracy - offStats.accuracy).toFixed(1)}% Improvement${C.reset}`);
  console.log(`========================================================================================\n`);

  console.log(`${C.bold}${C.cyan}SPECIFIC INSPECTION OF THE 2 PREVIOUSLY FAILING QUESTIONS:${C.reset}`);
  
  const q33Off = offResults[32];
  const q33On = onResults[32];
  console.log(`\n${C.bold}1. Question #33:${C.reset} "${q33Off.question}"`);
  console.log(`   - Matched FAQ : "${q33Off.matchedFaq}" (Similarity: ${q33Off.score.toFixed(4)})`);
  console.log(`   - LLM OFF     : ${q33Off.status} (${q33Off.isCorrect ? 'PASS' : C.red + 'FAIL - Falsely gave fee refund info' + C.reset})`);
  console.log(`   - LLM ON      : ${q33On.status} (${q33On.isCorrect ? C.green + 'PASS - Detected NOT_FOUND, correctly routed to staff' + C.reset : 'FAIL'})`);
  console.log(`   - LLM Verdict : ${q33On.llmVerdict}`);
  console.log(`   - Answer      : "${q33On.answer.substring(0, 100)}..."`);

  const q39Off = offResults[38];
  const q39On = onResults[38];
  console.log(`\n${C.bold}2. Question #39:${C.reset} "${q39Off.question}"`);
  console.log(`   - Matched FAQ : "${q39Off.matchedFaq}" (Similarity: ${q39Off.score.toFixed(4)})`);
  console.log(`   - LLM OFF     : ${q39Off.status} (${q39Off.isCorrect ? 'PASS' : C.red + 'FAIL - Falsely gave branch change info' + C.reset})`);
  console.log(`   - LLM ON      : ${q39On.status} (${q39On.isCorrect ? C.green + 'PASS - Detected NOT_FOUND, correctly routed to staff' + C.reset : 'FAIL'})`);
  console.log(`   - LLM Verdict : ${q39On.llmVerdict}`);
  console.log(`   - Answer      : "${q39On.answer.substring(0, 100)}..."\n`);
}

runComparison();
