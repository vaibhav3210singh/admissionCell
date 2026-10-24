import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}/ask`;
const ENV_PATH = path.join(__dirname, '.env');
const CURRENT_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD ?? '0.82');

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
  console.log(`${C.bold}${C.cyan} AI ADMISSION ENQUIRY ASSISTANT - THRESHOLD EVALUATION & BENCHMARK SUITE${C.reset}`);
  console.log(`${C.bold}${C.cyan}========================================================================================${C.reset}`);
  console.log(`${C.dim}Endpoint               : ${URL}${C.reset}`);
  console.log(`${C.dim}Current .env Threshold : ${CURRENT_THRESHOLD}${C.reset}\n`);

  let questionsFile = path.join(__dirname, 'testQuestions.json');
  if (!fs.existsSync(questionsFile)) {
    questionsFile = path.join(__dirname, 'tests', 'testQuestions.json');
  }
  if (!fs.existsSync(questionsFile)) {
    questionsFile = path.join(__dirname, '..', 'testQuestions.json');
  }
  if (!fs.existsSync(questionsFile)) {
    console.error(`${C.red}Error: testQuestions.json not found${C.reset}`);
    process.exit(1);
  }

  const questions = JSON.parse(fs.readFileSync(questionsFile, 'utf8'));

  // Verify server is online
  const isAlive = await checkServerHealth();
  if (!isAlive) {
    console.error(`${C.bold}${C.red}[ERROR] Backend server is not running on http://localhost:${PORT}.${C.reset}`);
    console.error(`${C.yellow}Please start the server first in another terminal with:${C.reset}`);
    console.error(`  ${C.bold}npm start${C.reset}\n`);
    process.exit(1);
  }

  console.log(`Sending ${questions.length} test queries across 3 evaluation groups to /ask...\n`);

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`  [${i + 1}/${questions.length}] Testing: "${q.question.substring(0, 45)}..."\r`);

    try {
      const response = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q.question })
      });

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
        score: data.similarity,
        status: statusText,
        expected: q.expectedBehavior,
        isCorrect: isCorrect
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
        isCorrect: false
      });
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nCompleted ${questions.length} queries in ${duration}s.\n`);

  // Print Formatted Table
  printDetailedTable(results);

  // Group summary at current threshold
  printGroupPerformance(results, CURRENT_THRESHOLD, 'CURRENT THRESHOLD');

  // Sweep and find best threshold
  const sweepResults = performThresholdSweep(results);
  printSweepTable(sweepResults);

  const best = sweepResults.best;
  console.log(`\n${C.bold}${C.green}========================================================================================${C.reset}`);
  console.log(`${C.bold}${C.green} RECOMMENDED THRESHOLD: ${best.threshold.toFixed(2)}${C.reset}`);
  console.log(`${C.bold}${C.green}========================================================================================${C.reset}`);
  console.log(`Overall Accuracy at recommended threshold: ${C.bold}${best.accuracy.toFixed(1)}% (${best.totalCorrect}/${results.length} questions)${C.reset}`);
  console.log(`- Group 1 (In FAQ, reworded / Hindi / Hinglish) : ${C.bold}${best.g1Correct}/20 correct${C.reset} (${(best.g1Correct / 20 * 100).toFixed(0)}% answered)`);
  console.log(`- Group 2 (Completely unrelated questions)     : ${C.bold}${best.g2Correct}/10 correct${C.reset} (${(best.g2Correct / 10 * 100).toFixed(0)}% handed off)`);
  console.log(`- Group 3 (Admissions queries NOT in FAQ)       : ${C.bold}${best.g3Correct}/10 correct${C.reset} (${(best.g3Correct / 10 * 100).toFixed(0)}% handed off)\n`);

  printGroupPerformance(results, best.threshold, `RECOMMENDED THRESHOLD (${best.threshold.toFixed(2)})`);

  return { results, bestThreshold: best.threshold };
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

function printDetailedTable(results) {
  console.log(`${C.bold}------------------------------------------------------------------------------------------------------------------------------------------------------${C.reset}`);
  console.log(`${C.bold}#   | Group | Question                                                 | Matched FAQ                                              | Score  | Status     | Match${C.reset}`);
  console.log(`${C.bold}------------------------------------------------------------------------------------------------------------------------------------------------------${C.reset}`);

  let currentGroupId = null;
  results.forEach(r => {
    const groupNum = r.group.startsWith('Group 1') ? 'G1' : r.group.startsWith('Group 2') ? 'G2' : 'G3';
    
    if (currentGroupId !== groupNum) {
      currentGroupId = groupNum;
      const groupTitle = r.group.startsWith('Group 1')
        ? '>>> GROUP 1: In FAQ (Reworded / Hindi / Hinglish) - Expected: Answered'
        : r.group.startsWith('Group 2')
        ? '>>> GROUP 2: Completely Unrelated (Weather, Cricket, etc.) - Expected: Handed Off'
        : '>>> GROUP 3: Admission Questions NOT in FAQ - Expected: Handed Off';
      console.log(`${C.magenta}${groupTitle}${C.reset}`);
    }

    const idStr = String(r.id).padEnd(3);
    const gStr = groupNum.padEnd(5);
    const qStr = truncate(r.question, 54).padEnd(56);
    const fStr = truncate(r.matchedFaq, 54).padEnd(56);
    const sStr = r.score.toFixed(4).padStart(6);
    const statusColor = r.status === 'Answered' ? C.green : C.yellow;
    const statStr = (statusColor + r.status.padEnd(10) + C.reset);
    const evalIcon = r.isCorrect ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;

    console.log(`${idStr} | ${gStr} | ${qStr} | ${fStr} | ${sStr} | ${statStr} | ${evalIcon}`);
  });
  console.log(`${C.bold}------------------------------------------------------------------------------------------------------------------------------------------------------${C.reset}\n`);
}

function printGroupPerformance(results, threshold, label) {
  let g1Answered = 0, g1Total = 0;
  let g2Handoff = 0, g2Total = 0;
  let g3Handoff = 0, g3Total = 0;

  const g1Scores = [], g2Scores = [], g3Scores = [];

  results.forEach(r => {
    const isAnswered = r.score >= threshold;
    if (r.id <= 20) {
      g1Total++;
      g1Scores.push(r.score);
      if (isAnswered) g1Answered++;
    } else if (r.id <= 30) {
      g2Total++;
      g2Scores.push(r.score);
      if (!isAnswered) g2Handoff++;
    } else {
      g3Total++;
      g3Scores.push(r.score);
      if (!isAnswered) g3Handoff++;
    }
  });

  const totalCorrect = g1Answered + g2Handoff + g3Handoff;
  const totalQueries = results.length;
  const accuracy = ((totalCorrect / totalQueries) * 100).toFixed(1);

  const avg = arr => (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4);
  const min = arr => Math.min(...arr).toFixed(4);
  const max = arr => Math.max(...arr).toFixed(4);

  console.log(`${C.bold}Performance Summary at ${label} = ${threshold.toFixed(2)}:${C.reset}`);
  console.log(`  - Group 1 (In FAQ, reworded)      : ${g1Answered}/${g1Total} answered correctly (${((g1Answered/g1Total)*100).toFixed(0)}%) | Scores: min=${min(g1Scores)}, avg=${avg(g1Scores)}, max=${max(g1Scores)}`);
  console.log(`  - Group 2 (Unrelated topics)      : ${g2Handoff}/${g2Total} handed off correctly (${((g2Handoff/g2Total)*100).toFixed(0)}%) | Scores: min=${min(g2Scores)}, avg=${avg(g2Scores)}, max=${max(g2Scores)}`);
  console.log(`  - Group 3 (Admissions not in FAQ) : ${g3Handoff}/${g3Total} handed off correctly (${((g3Handoff/g3Total)*100).toFixed(0)}%) | Scores: min=${min(g3Scores)}, avg=${avg(g3Scores)}, max=${max(g3Scores)}`);
  console.log(`  ${C.bold}-> Total Correct Decisions        : ${totalCorrect}/${totalQueries} (${accuracy}% Accuracy)${C.reset}\n`);
}

function performThresholdSweep(results) {
  const sweepData = [];
  let best = null;

  for (let t = 75; t <= 92; t++) {
    const thresh = Number((t / 100).toFixed(2));
    let g1Correct = 0, g2Correct = 0, g3Correct = 0;

    results.forEach(r => {
      const isAnswered = r.score >= thresh;
      if (r.id <= 20) {
        if (isAnswered) g1Correct++;
      } else if (r.id <= 30) {
        if (!isAnswered) g2Correct++;
      } else {
        if (!isAnswered) g3Correct++;
      }
    });

    const totalCorrect = g1Correct + g2Correct + g3Correct;
    const accuracy = (totalCorrect / results.length) * 100;

    const row = {
      threshold: thresh,
      g1Correct,
      g2Correct,
      g3Correct,
      totalCorrect,
      accuracy
    };

    sweepData.push(row);

    if (!best || row.totalCorrect > best.totalCorrect || (row.totalCorrect === best.totalCorrect && row.g1Correct > best.g1Correct)) {
      best = row;
    }
  }

  return { sweepData, best };
}

function printSweepTable({ sweepData, best }) {
  console.log(`${C.bold}-------------------------------------------------------------------------------------------------${C.reset}`);
  console.log(`${C.bold}THRESHOLD SWEEP ANALYSIS (Range: 0.75 - 0.92)${C.reset}`);
  console.log(`${C.bold}-------------------------------------------------------------------------------------------------${C.reset}`);
  console.log(`${C.bold}Threshold | G1 Answered (/20) | G2 Handed Off (/10) | G3 Handed Off (/10) | Total (/40) | Accuracy | Status${C.reset}`);
  console.log(`-------------------------------------------------------------------------------------------------`);

  sweepData.forEach(s => {
    const isCurrent = Math.abs(s.threshold - CURRENT_THRESHOLD) < 0.001;
    const isBest = Math.abs(s.threshold - best.threshold) < 0.001;
    let mark = '        ';
    if (isBest && isCurrent) mark = `${C.green}BEST/CUR${C.reset}`;
    else if (isBest) mark = `${C.bold}${C.green}OPTIMAL*${C.reset}`;
    else if (isCurrent) mark = `${C.yellow}CURRENT ${C.reset}`;

    const tStr = s.threshold.toFixed(2).padEnd(9);
    const g1Str = `${s.g1Correct}/20 (${(s.g1Correct * 5).toString().padStart(3)}%)`.padEnd(18);
    const g2Str = `${s.g2Correct}/10 (${(s.g2Correct * 10).toString().padStart(3)}%)`.padEnd(19);
    const g3Str = `${s.g3Correct}/10 (${(s.g3Correct * 10).toString().padStart(3)}%)`.padEnd(19);
    const totStr = `${s.totalCorrect}/40`.padEnd(11);
    const accStr = `${s.accuracy.toFixed(1)}%`.padEnd(8);

    console.log(`${tStr} | ${g1Str} | ${g2Str} | ${g3Str} | ${totStr} | ${accStr} | ${mark}`);
  });
  console.log(`-------------------------------------------------------------------------------------------------`);
}

// If invoked directly via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runEvaluation().catch(err => {
    console.error('Evaluation failed:', err);
    process.exit(1);
  });
}

export { runEvaluation };
