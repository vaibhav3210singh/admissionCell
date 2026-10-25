import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}/ask`;
const CURRENT_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD ?? '0.86');
const HIGH_CONFIDENCE_THRESHOLD = parseFloat(process.env.HIGH_CONFIDENCE_THRESHOLD ?? '0.90');

// ANSI Color Helpers
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m'
};

async function checkServerHealth() {
  try {
    const res = await fetch(`http://localhost:${PORT}/health`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function runEvaluation() {
  console.log(`${C.bold}${C.cyan}\n========================================================================================${C.reset}`);
  console.log(`${C.bold}${C.cyan} AI ADMISSION ENQUIRY ASSISTANT - 60-QUESTION BENCHMARK & ROUTING SUITE${C.reset}`);
  console.log(`${C.bold}${C.cyan}========================================================================================${C.reset}`);
  console.log(`${C.dim}Endpoint                  : ${URL}${C.reset}`);
  console.log(`${C.dim}Base Similarity Threshold : ${CURRENT_THRESHOLD}${C.reset}`);
  console.log(`${C.dim}High Confidence Threshold : ${HIGH_CONFIDENCE_THRESHOLD}${C.reset}\n`);

  let questionsFile = path.join(__dirname, 'testQuestions.json');
  if (!fs.existsSync(questionsFile)) {
    console.error(`${C.red}Error: testQuestions.json not found${C.reset}`);
    process.exit(1);
  }

  const questions = JSON.parse(fs.readFileSync(questionsFile, 'utf8'));

  // Verify server is online
  const isAlive = await checkServerHealth();
  if (!isAlive) {
    console.error(`${C.bold}${C.red}[ERROR] Backend server is not running on http://localhost:${PORT}.${C.reset}`);
    console.error(`${C.yellow}Please start the server first in another terminal with: npm start${C.reset}\n`);
    process.exit(1);
  }

  console.log(`Sending ${questions.length} test queries across 4 evaluation groups to /ask...\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`  [${i + 1}/${questions.length}] Testing #${q.id}: "${q.question.substring(0, 42)}..."\r`);

    const qStart = Date.now();
    try {
      const response = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q.question })
      });

      const qLatency = Date.now() - qStart;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const isAnswered = !data.handoff;
      const statusText = isAnswered ? 'Answered' : 'Handed Off';
      const isCorrect = q.expectedBehavior === statusText;

      results.push({
        id: q.id,
        group: q.group,
        category: q.category,
        question: q.question,
        matchedFaq: data.matchedQuestion || 'None',
        score: data.similarity ?? 0,
        status: statusText,
        expected: q.expectedBehavior,
        isCorrect: isCorrect,
        llmUsed: Boolean(data.llmUsed),
        tier: data.tier || (data.similarity >= HIGH_CONFIDENCE_THRESHOLD ? 'high_confidence' : data.similarity >= CURRENT_THRESHOLD ? 'borderline' : 'handoff'),
        latencyMs: qLatency
      });
    } catch (err) {
      console.error(`\n${C.red}Failed to query test #${q.id}: ${err.message}${C.reset}`);
      results.push({
        id: q.id,
        group: q.group,
        category: q.category,
        question: q.question,
        matchedFaq: 'ERROR',
        score: 0,
        status: 'Error',
        expected: q.expectedBehavior,
        isCorrect: false,
        llmUsed: false,
        tier: 'error',
        latencyMs: 0
      });
    }

    // Small delay to prevent bursting
    await new Promise(r => setTimeout(r, 120));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nCompleted ${questions.length} queries in ${duration}s.\n`);

  // Detailed Table
  printDetailedTable(results);

  // Group Performance & Routing Analysis
  printRoutingAndPerformance(results);

  return results;
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

function printDetailedTable(results) {
  console.log(`${C.bold}------------------------------------------------------------------------------------------------------------------------------------------------------------${C.reset}`);
  console.log(`${C.bold}#   | Grp | Question                                             | Matched FAQ                                          | Score  | LLM?  | Status     | Match${C.reset}`);
  console.log(`${C.bold}------------------------------------------------------------------------------------------------------------------------------------------------------------${C.reset}`);

  let currentGroupId = null;
  results.forEach(r => {
    let groupNum = 'G1';
    if (r.id > 20 && r.id <= 30) groupNum = 'G2';
    else if (r.id > 30 && r.id <= 40) groupNum = 'G3';
    else if (r.id > 40) groupNum = 'G4';
    
    if (currentGroupId !== groupNum) {
      currentGroupId = groupNum;
      const groupTitle = groupNum === 'G1'
        ? '>>> GROUP 1: In FAQ (Reworded / Hindi / Hinglish) - Expected: Answered'
        : groupNum === 'G2'
        ? '>>> GROUP 2: Completely Unrelated (Weather, Cricket, etc.) - Expected: Handed Off'
        : groupNum === 'G3'
        ? '>>> GROUP 3: Admission Questions NOT in FAQ - Expected: Handed Off'
        : '>>> GROUP 4: New Hindi & Hinglish Queries (In FAQ) - Expected: Answered';
      console.log(`${C.magenta}${groupTitle}${C.reset}`);
    }

    const idStr = String(r.id).padEnd(3);
    const gStr = groupNum.padEnd(3);
    const qStr = truncate(r.question, 50).padEnd(52);
    const fStr = truncate(r.matchedFaq, 50).padEnd(52);
    const sStr = r.score.toFixed(4).padStart(6);
    const llmStr = r.llmUsed ? `${C.cyan}YES${C.reset} ` : `${C.dim}NO ${C.reset} `;
    const statusColor = r.status === 'Answered' ? C.green : C.yellow;
    const statStr = (statusColor + r.status.padEnd(10) + C.reset);
    const evalIcon = r.isCorrect ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;

    console.log(`${idStr} | ${gStr} | ${qStr} | ${fStr} | ${sStr} | ${llmStr} | ${statStr} | ${evalIcon}`);
  });
  console.log(`${C.bold}------------------------------------------------------------------------------------------------------------------------------------------------------------${C.reset}\n`);
}

function printRoutingAndPerformance(results) {
  let g1Correct = 0, g1Total = 0;
  let g2Correct = 0, g2Total = 0;
  let g3Correct = 0, g3Total = 0;
  let g4Correct = 0, g4Total = 0;

  let answeredWithoutLlmCount = 0;
  let borderlineLlmCount = 0;
  let handoffBelowThreshCount = 0;

  const llmLatencies = [];

  results.forEach(r => {
    if (r.id <= 20) {
      g1Total++;
      if (r.isCorrect) g1Correct++;
    } else if (r.id <= 30) {
      g2Total++;
      if (r.isCorrect) g2Correct++;
    } else if (r.id <= 40) {
      g3Total++;
      if (r.isCorrect) g3Correct++;
    } else {
      g4Total++;
      if (r.isCorrect) g4Correct++;
    }

    if (r.llmUsed) {
      borderlineLlmCount++;
      llmLatencies.push(r.latencyMs);
    } else if (r.status === 'Answered') {
      answeredWithoutLlmCount++;
    } else {
      handoffBelowThreshCount++;
    }
  });

  const totalCorrect = g1Correct + g2Correct + g3Correct + g4Correct;
  const total = results.length;
  const overallAcc = ((totalCorrect / total) * 100).toFixed(1);

  console.log(`${C.bold}${C.green}========================================================================================${C.reset}`);
  console.log(`${C.bold}${C.green}                     60-QUESTION EVALUATION ACCURACY REPORT                            ${C.reset}`);
  console.log(`${C.bold}${C.green}========================================================================================${C.reset}`);
  console.log(`- Group 1: In FAQ (Reworded / Hindi / Hinglish) : ${C.bold}${g1Correct}/${g1Total}${C.reset} (${((g1Correct/g1Total)*100).toFixed(1)}% correct)`);
  console.log(`- Group 2: Out of Domain / Irrelevant           : ${C.bold}${g2Correct}/${g2Total}${C.reset} (${((g2Correct/g2Total)*100).toFixed(1)}% handed off correctly)`);
  console.log(`- Group 3: Admission Topics NOT in FAQ          : ${C.bold}${g3Correct}/${g3Total}${C.reset} (${((g3Correct/g3Total)*100).toFixed(1)}% handed off correctly)`);
  console.log(`- Group 4: New Hindi & Hinglish Queries         : ${C.bold}${g4Correct}/${g4Total}${C.reset} (${((g4Correct/g4Total)*100).toFixed(1)}% correct)`);
  console.log(`----------------------------------------------------------------------------------------`);
  console.log(`${C.bold}TOTAL OVERALL ACCURACY : ${totalCorrect}/${total} (${overallAcc}%)${C.reset}\n`);

  console.log(`${C.bold}${C.cyan}========================================================================================${C.reset}`);
  console.log(`${C.bold}${C.cyan}                      ROUTING & LLM LATENCY BREAKDOWN                                  ${C.reset}`);
  console.log(`${C.bold}${C.cyan}========================================================================================${C.reset}`);
  console.log(`- High Confidence Direct Answers (No LLM needed)  : ${C.bold}${answeredWithoutLlmCount}${C.reset} turns (similarity >= ${HIGH_CONFIDENCE_THRESHOLD})`);
  console.log(`- Borderline Cases Sent to LLM for Verification   : ${C.bold}${borderlineLlmCount}${C.reset} turns (${CURRENT_THRESHOLD} <= similarity < ${HIGH_CONFIDENCE_THRESHOLD})`);
  console.log(`- Out-of-Domain / Below Threshold Direct Handoffs : ${C.bold}${handoffBelowThreshCount}${C.reset} turns (similarity < ${CURRENT_THRESHOLD})`);

  if (llmLatencies.length > 0) {
    const avgLlm = (llmLatencies.reduce((a, b) => a + b, 0) / llmLatencies.length).toFixed(1);
    const sorted = [...llmLatencies].sort((a, b) => a - b);
    const p90 = sorted[Math.max(0, Math.ceil(0.90 * sorted.length) - 1)];
    const max = sorted[sorted.length - 1];
    console.log(`\nReal LLM Round-Trip Latency (computed ONLY over the ${llmLatencies.length} LLM-called turns):`);
    console.log(`  • Average Latency : ${C.bold}${avgLlm} ms${C.reset}`);
    console.log(`  • 90th Percentile : ${C.bold}${p90} ms${C.reset}`);
    console.log(`  • Maximum Latency : ${C.bold}${max} ms${C.reset}`);
  } else {
    console.log(`\nNo queries triggered LLM verification in this run.`);
  }
  console.log(`${C.bold}${C.cyan}========================================================================================${C.reset}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runEvaluation().catch(err => {
    console.error('Evaluation failed:', err);
    process.exit(1);
  });
}

export { runEvaluation };
