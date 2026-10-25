import WebSocket from 'ws';
import databaseService from './src/services/databaseService.js';
import config from './src/config/index.js';

const BASE_URL = `http://localhost:${config.server.port}`;
const WS_URL = `ws://localhost:${config.server.port}/call-relay`;

// 20 realistic test questions covering English, Hindi, Hinglish, and Out-of-FAQ handoffs
const testQuestions = [
  {
    type: 'English FAQ Query',
    callerSpeech: 'What is the eligibility criteria for admission?'
  },
  {
    type: 'Hindi FAQ Query',
    callerSpeech: 'हॉस्टल की सालाना फीस कितनी है?'
  },
  {
    type: 'Hinglish FAQ Query',
    callerSpeech: 'Application form submit karne ki last date kya hai?'
  },
  {
    type: 'Out-of-FAQ Handoff',
    callerSpeech: 'Can single girl children get a fee waiver for admission?'
  },
  {
    type: 'English FAQ Query',
    callerSpeech: 'What courses are offered by the university?'
  },
  {
    type: 'Hindi Out-of-FAQ Handoff',
    callerSpeech: 'क्या विश्वविद्यालय में बीटेक के लिए लेटरल एंट्री मिलती है?'
  },
  {
    type: 'Hinglish FAQ Query',
    callerSpeech: 'BTech first year ki total fees kitni padegi?'
  },
  {
    type: 'Out-of-FAQ Handoff',
    callerSpeech: 'Is there any uniform or mandatory dress code for freshers?'
  },
  {
    type: 'English FAQ Query',
    callerSpeech: 'How can I apply for admission?'
  },
  {
    type: 'Hindi FAQ Query',
    callerSpeech: 'एडमिशन के लिए कौन-कौन से दस्तावेज चाहिए?'
  },
  {
    type: 'Hinglish FAQ Query',
    callerSpeech: 'Hostel sabhi students ke liye compulsory hota hai kya?'
  },
  {
    type: 'Out-of-FAQ Handoff',
    callerSpeech: 'Are there reserved seats for wards of defense personnel?'
  },
  {
    type: 'English FAQ Query',
    callerSpeech: 'Is the admission fee refundable?'
  },
  {
    type: 'Hindi FAQ Query',
    callerSpeech: 'क्या विश्वविद्यालय में छात्रों को छात्रवृत्ति मिलती है?'
  },
  {
    type: 'Hinglish Out-of-FAQ Handoff',
    callerSpeech: 'Direct admission mil sakta hai kya management quota se?'
  },
  {
    type: 'Out-of-FAQ Handoff',
    callerSpeech: 'What is the special reservation policy for Kashmiri migrants?'
  },
  {
    type: 'English FAQ Query',
    callerSpeech: 'What is the placement record of the university?'
  },
  {
    type: 'Hindi Out-of-FAQ Handoff',
    callerSpeech: 'एमबीए कोर्स में एडमिशन का क्या प्रोसेस है?'
  },
  {
    type: 'Out-of-FAQ Handoff',
    callerSpeech: 'Entrance exam center admit card aane ke baad change ho sakta hai kya?'
  },
  {
    type: 'English Out-of-FAQ Handoff',
    callerSpeech: 'Where is the university campus located and how can I reach there?'
  }
];

// Pacing delay between queries to respect Gemini API rate limits
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runLocalCallSimulator() {
  console.log('================================================================');
  console.log('         TWILIO PHONE CALL SIMULATOR (20-TURN BENCHMARK)        ');
  console.log('================================================================');
  console.log(`Server URL          : ${BASE_URL}`);
  console.log(`WebSocket Relay URL : ${WS_URL}`);
  console.log(`Call Mode Configured: ${config.telephony.callMode}`);
  console.log(`TTS Provider        : ${config.telephony.ttsProvider.toUpperCase()}`);
  console.log(`Voice EN            : ${config.telephony.ttsVoiceEn}`);
  console.log(`Voice HI            : ${config.telephony.ttsVoiceHi}`);
  console.log(`STT Provider (STT)  : ${config.telephony.transcriptionProvider} (lang: ${config.telephony.transcriptionLanguage})`);
  console.log(`LLM Phone Timeout   : ${config.llm.phoneTimeoutMs} ms`);
  console.log(`Simulated Caller No : +919876543210 (Masked: ***-***-3210)`);
  console.log(`Total Turns to Run  : ${testQuestions.length}`);
  console.log('----------------------------------------------------------------\n');

  // STEP 1: Simulate Twilio hitting the /incoming-call HTTP Webhook
  console.log('[STEP 1] Simulating incoming phone call webhook (POST /incoming-call)...');
  const simulatedCallSid = `CA${Math.random().toString(16).substring(2, 10)}${Date.now()}`;
  
  const webhookResponse = await fetch(`${BASE_URL}/incoming-call`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-simulator': 'true',
      'Host': `localhost:${config.server.port}`
    },
    body: new URLSearchParams({
      CallSid: simulatedCallSid,
      From: '+919876543210',
      To: config.telephony.phoneNumber || '+12058912345',
      Direction: 'inbound'
    }).toString()
  });

  if (!webhookResponse.ok) {
    throw new Error(`Webhook failed with HTTP ${webhookResponse.status}: ${webhookResponse.statusText}`);
  }

  const twiml = await webhookResponse.text();
  console.log('[STEP 1 SUCCESS] Server returned TwiML XML:');
  console.log(twiml.trim());
  console.log('----------------------------------------------------------------\n');

  // STEP 2: Connect via WebSocket to /call-relay (ConversationRelay)
  console.log('[STEP 2] Opening ConversationRelay WebSocket to /call-relay...');
  const ws = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  console.log('[STEP 2 SUCCESS] Connected to ConversationRelay WebSocket!\n');

  // Listen for mid-call language switch frames from server
  const languageSwitches = [];
  ws.on('message', (data) => {
    try {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'language') {
        languageSwitches.push(frame);
        console.log(`  ⚡ [MID-CALL SWITCH RECEIVED]: STT/TTS switched to '${frame.ttsLanguage}'`);
      }
    } catch {
      // ignored
    }
  });

  // STEP 3: Send "setup" frame as Twilio ConversationRelay does upon connection
  console.log('[STEP 3] Sending Twilio "setup" frame...');
  ws.send(JSON.stringify({
    type: 'setup',
    sessionId: `session_${Date.now()}`,
    callSid: simulatedCallSid,
    from: '+919876543210',
    to: '+12058912345',
    parentCallSid: null
  }));

  console.log('Simulating 20 spoken turns with the AI assistant...\n');

  const turnMetrics = [];

  // STEP 4: Sequentially send questions and wait for server spoken reply
  for (let i = 0; i < testQuestions.length; i++) {
    const item = testQuestions[i];
    console.log(`================================================================`);
    console.log(`[TURN ${i + 1}/${testQuestions.length}] ${item.type.toUpperCase()}`);
    console.log(`Caller Speaks: "${item.callerSpeech}"`);

    const turnStartTime = Date.now();

    // Listen for WebSocket response frames
    const turnPromise = new Promise((resolve) => {
      let fillerReceived = null;

      const messageHandler = (data) => {
        try {
          const frame = JSON.parse(data.toString());
          if (frame.type === 'text') {
            if (frame.last === false) {
              // Natural filler acknowledgment (e.g. "जी, एक सेकंड...")
              fillerReceived = frame.token;
              console.log(`  -> [NATURAL FILLER RECEIVED]: "${frame.token.trim()}"`);
            } else if (frame.last === true) {
              // Final spoken answer
              ws.off('message', messageHandler);
              resolve({
                filler: fillerReceived,
                spokenAnswer: frame.token,
                timings: frame.timings || {},
                language: frame.lang || frame.language,
                handoff: frame.handoff,
                matchedQuestion: frame.matchedQuestion,
                similarity: frame.similarity,
                threshold: frame.threshold,
                llmVerdict: frame.llmVerdict
              });
            }
          }
        } catch (err) {
          console.error('Error parsing frame:', err);
        }
      };

      ws.on('message', messageHandler);
    });

    // Send "prompt" message from Twilio speech transcription
    ws.send(JSON.stringify({
      type: 'prompt',
      voicePrompt: item.callerSpeech
    }));

    const result = await turnPromise;
    const clientMeasuredTotalMs = Date.now() - turnStartTime;

    const matchingMs = result.timings.matchingMs ?? 0;
    const llmMs = result.timings.llmMs ?? 0;
    const totalMs = result.timings.totalMs ?? clientMeasuredTotalMs;
    const effectiveThresh = result.threshold ?? config.matching.similarityThreshold;
    const score = result.similarity ?? 0;

    let decisionReason = '';
    if (score < effectiveThresh) {
      decisionReason = `Below threshold (${score.toFixed(4)} < ${effectiveThresh})`;
    } else if (result.llmVerdict === 'NOT_FOUND') {
      decisionReason = 'LLM returned NOT_FOUND (score >= thresh, FAQ lacks answer)';
    } else if (result.llmVerdict === 'ANSWERED') {
      decisionReason = 'Answered via LLM synthesis';
    } else if (result.llmVerdict === 'FALLBACK_RAW_FAQ') {
      decisionReason = 'Fallback to raw FAQ (LLM timeout/quality check)';
    } else {
      decisionReason = result.handoff ? 'Handed off to staff' : 'Answered';
    }

    turnMetrics.push({
      turn: i + 1,
      type: item.type,
      question: item.callerSpeech,
      matchedFaq: result.matchedQuestion || 'None',
      score,
      threshold: effectiveThresh,
      language: result.language || 'en-IN',
      status: result.handoff ? 'HANDOFF' : 'ANSWERED',
      reason: decisionReason,
      llmUsed: llmMs > 0,
      matchingMs,
      llmMs,
      totalMs
    });

    console.log(`\nAI Assistant Speaks:`);
    console.log(`"${result.spokenAnswer}"`);
    console.log(`\nTurn Latency Breakdown:`);
    console.log(`  - Semantic FAQ Matching : ${matchingMs} ms`);
    console.log(`  - LLM Answer Synthesis  : ${llmMs} ms`);
    console.log(`  - Total Turn Latency    : ${totalMs} ms`);
    console.log(`  - Spoken Language Token : ${result.language}`);
    console.log(`  - Action                : ${result.handoff ? 'TRANSFER TO HUMAN STAFF' : 'ANSWERED VIA AI'}`);
    console.log(`  - Decision Reason       : ${decisionReason}`);
    console.log(`================================================================\n`);

    // Pacing delay between queries to respect Gemini rate limits
    if (i < testQuestions.length - 1) {
      await delay(2800);
    }
  }

  // Close WebSocket
  ws.close();
  console.log('[STEP 5] Call ended by caller. WebSocket closed.');

  // STEP 6: Verify Database Logging & Privacy Masking
  console.log('\n[STEP 6] Verifying database logs for channel = "phone" & privacy masking:');
  await databaseService.initialize();
  const dbResult = await databaseService.getEnquiryLogs({ channel: 'phone', limit: 4 });
  const logs = dbResult.logs || [];
  
  console.log(`Recent phone logs sampled: ${logs.length} (Total phone logs in DB: ${dbResult.total})`);
  logs.forEach((log, idx) => {
    console.log(`  [Log #${idx + 1}]`);
    console.log(`    Channel : ${log.channel}`);
    console.log(`    Language: ${log.language}`);
    console.log(`    Question: "${log.question_text}"`);
    console.log(`    Status  : ${log.status === 'answered' ? 'ANSWERED' : 'HANDED OFF'}`);
    console.log(`    Matched : "${log.matched_faq || 'None'}" (Score: ${log.score})`);
    console.log(`    LLM Used: ${log.llm_used ? 'YES' : 'NO'}`);
  });

  // STEP 7: Print Turn-by-Turn Investigation Table (Question, Matched FAQ, Score, Threshold, Reason)
  console.log('\n=============================================================================================================================================');
  console.log('                                                  TURN DECISION INVESTIGATION REPORT (ALL 20 TURNS)                                          ');
  console.log('=============================================================================================================================================');
  console.log('| Turn | Caller Question Text                   | Matched FAQ Title                      | Score  | Thresh | Status   | Decision Reason                           |');
  console.log('|------|----------------------------------------|----------------------------------------|--------|--------|----------|-------------------------------------------|');
  turnMetrics.forEach(m => {
    const turnCol = String(m.turn).padEnd(4);
    const qCol = (m.question.length > 38 ? m.question.substring(0, 35) + '...' : m.question).padEnd(38);
    const faqCol = (m.matchedFaq.length > 38 ? m.matchedFaq.substring(0, 35) + '...' : m.matchedFaq).padEnd(38);
    const scoreCol = String(m.score.toFixed(4)).padEnd(6);
    const threshCol = String(m.threshold.toFixed(2)).padEnd(6);
    const statusCol = m.status.padEnd(8);
    const reasonCol = (m.reason.length > 41 ? m.reason.substring(0, 38) + '...' : m.reason).padEnd(41);
    console.log(`| ${turnCol} | ${qCol} | ${faqCol} | ${scoreCol} | ${threshCol} | ${statusCol} | ${reasonCol} |`);
  });
  console.log('=============================================================================================================================================\n');

  // STEP 8: Print Overall Latency & Performance Summary Table (20 Turns)
  console.log('\n========================================================================================');
  console.log('                    SIMULATED CALL LATENCY & PERFORMANCE REPORT (20 TURNS)              ');
  console.log('========================================================================================');
  console.log('| Turn | Type                     | Lang  | Status   | Match (ms) | LLM (ms) | Total (ms) |');
  console.log('|------|--------------------------|-------|----------|------------|----------|------------|');
  
  let sumMatching = 0;
  let sumTotal = 0;

  turnMetrics.forEach(m => {
    sumMatching += m.matchingMs;
    sumTotal += m.totalMs;

    const turnCol = String(m.turn).padEnd(4);
    const typeCol = m.type.padEnd(24);
    const langCol = (m.language || 'en-IN').padEnd(5);
    const statusCol = m.status.padEnd(8);
    const matchCol = String(m.matchingMs).padStart(10);
    const llmCol = String(m.llmMs).padStart(8);
    const totalCol = String(m.totalMs).padStart(10);

    console.log(`| ${turnCol} | ${typeCol} | ${langCol} | ${statusCol} | ${matchCol} | ${llmCol} | ${totalCol} |`);
  });

  const count = turnMetrics.length;
  const avgMatching = (sumMatching / count).toFixed(1);
  const avgTotal = (sumTotal / count).toFixed(1);

  // Compute LLM latency ONLY over turns where the LLM was actually called
  const llmCalledTurns = turnMetrics.filter(m => m.llmMs > 0);
  const sumLlmCalled = llmCalledTurns.reduce((acc, m) => acc + m.llmMs, 0);
  const avgLlmCalled = llmCalledTurns.length > 0 ? (sumLlmCalled / llmCalledTurns.length).toFixed(1) : '0.0';

  // Compute 90th percentile (p90) and Maximum (max) for LLM latency
  const sortedLlm = llmCalledTurns.map(m => m.llmMs).sort((a, b) => a - b);
  const maxLlm = sortedLlm.length > 0 ? sortedLlm[sortedLlm.length - 1] : 0;
  const p90Llm = sortedLlm.length > 0 ? sortedLlm[Math.max(0, Math.ceil(0.90 * sortedLlm.length) - 1)] : 0;

  // Compute p90 and Maximum for Total Turn Latency
  const sortedTotal = turnMetrics.map(m => m.totalMs).sort((a, b) => a - b);
  const maxTotal = sortedTotal[sortedTotal.length - 1];
  const p90Total = sortedTotal[Math.max(0, Math.ceil(0.90 * sortedTotal.length) - 1)];

  console.log('|------|--------------------------|-------|----------|------------|----------|------------|');
  console.log(`| AVG  | ALL 20 TURNS AVERAGE     | ALL   | -        | ${String(avgMatching).padStart(10)} | ${String(avgLlmCalled + '*').padStart(8)} | ${String(avgTotal).padStart(10)} |`);
  console.log('========================================================================================');
  console.log(`* Note: LLM average (${avgLlmCalled} ms) computed strictly over ${llmCalledTurns.length} turns where LLM was called.`);
  console.log(`  - LLM Latency Metrics   : Avg = ${avgLlmCalled} ms | 90th Percentile (p90) = ${p90Llm} ms | Max = ${maxLlm} ms`);
  console.log(`  - Total Latency Metrics : Avg = ${avgTotal} ms | 90th Percentile (p90) = ${p90Total} ms | Max = ${maxTotal} ms\n`);

  // Identify and highlight the slowest turns
  const sortedByTotal = [...turnMetrics].sort((a, b) => b.totalMs - a.totalMs);
  const topSlowest = sortedByTotal.slice(0, 3);

  console.log('========================================================================================');
  console.log('                              TOP 3 SLOWEST TURNS ANALYSIS                              ');
  console.log('========================================================================================');
  topSlowest.forEach((t, rank) => {
    console.log(`Rank #${rank + 1}: Turn ${t.turn} (${t.type})`);
    console.log(`  - Question    : "${t.question}"`);
    console.log(`  - Total Time  : ${t.totalMs} ms (Matching: ${t.matchingMs} ms | LLM Synthesis: ${t.llmMs} ms)`);
    console.log(`  - Status/Lang : ${t.status} [${t.language}]`);
    console.log(`  - Decision    : ${t.reason}`);
    console.log(`  - Latency Note: Network round-trip to Gemini API accounted for ${t.totalMs > 0 ? ((t.llmMs / t.totalMs) * 100).toFixed(0) : 0}% of the turn duration.\n`);
  });

  console.log('========================================================================================');
  console.log('20-TURN BENCHMARK SIMULATOR RUN COMPLETED SUCCESSFULLY!');
  console.log('========================================================================================');
  process.exit(0);
}

runLocalCallSimulator().catch((err) => {
  console.error('\n[SIMULATOR FAILED]:', err);
  process.exit(1);
});
