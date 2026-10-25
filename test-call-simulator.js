import WebSocket from 'ws';
import databaseService from './src/services/databaseService.js';
import config from './src/config/index.js';

const BASE_URL = `http://localhost:${config.server.port}`;
const WS_URL = `ws://localhost:${config.server.port}/call-relay`;

// 4 realistic test questions across languages + out-of-FAQ handoff
const testQuestions = [
  {
    type: 'English Admission Query',
    callerSpeech: 'What is the eligibility criteria for admission?'
  },
  {
    type: 'Hindi Admission Query',
    callerSpeech: 'हॉस्टल की सालाना फीस कितनी है?'
  },
  {
    type: 'Hinglish Admission Query',
    callerSpeech: 'Application form submit karne ki last date kya hai?'
  },
  {
    type: 'Out-of-FAQ Handoff Query',
    callerSpeech: 'Can single girl children get a fee waiver for admission?'
  }
];

// Helper delay to avoid hitting Gemini free tier rate limits between turns
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runLocalCallSimulator() {
  console.log('================================================================');
  console.log('         TWILIO PHONE CALL SIMULATOR (LOCAL TEST HARNESS)       ');
  console.log('================================================================');
  console.log(`Server URL          : ${BASE_URL}`);
  console.log(`WebSocket Relay URL : ${WS_URL}`);
  console.log(`Call Mode Configured: ${config.telephony.callMode}`);
  console.log(`Simulated Caller No : +919876543210 (Masked: ***-***-3210)`);
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

  console.log('Simulating spoken turns with the AI assistant...\n');

  // STEP 4: Sequentially send questions and wait for server spoken reply
  for (let i = 0; i < testQuestions.length; i++) {
    const item = testQuestions[i];
    console.log(`================================================================`);
    console.log(`[TURN ${i + 1}/${testQuestions.length}] ${item.type.toUpperCase()}`);
    console.log(`Caller Speaks: "${item.callerSpeech}"`);

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
                spokenAnswer: frame.token
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
    console.log(`\nAI Assistant Speaks:`);
    console.log(`"${result.spokenAnswer}"`);
    console.log(`================================================================\n`);

    // Pacing delay between queries to respect Gemini rate limits
    if (i < testQuestions.length - 1) {
      console.log('Waiting 3.5s before next turn to respect API rate limits...');
      await delay(3500);
    }
  }

  // Close WebSocket
  ws.close();
  console.log('[STEP 5] Call ended by caller. WebSocket closed.');

  // STEP 6: Verify Database Logging & Privacy Masking
  console.log('\n[STEP 6] Verifying database logs for channel = "phone" & privacy masking:');
  await databaseService.initialize();
  const result = await databaseService.getEnquiryLogs({ channel: 'phone', limit: 4 });
  const logs = result.logs || [];
  
  console.log(`Total phone logs retrieved: ${logs.length} (Total matching in DB: ${result.total})`);
  logs.forEach((log, idx) => {
    console.log(`  [Log #${idx + 1}]`);
    console.log(`    Channel : ${log.channel}`);
    console.log(`    Language: ${log.language}`);
    console.log(`    Question: "${log.question_text}"`);
    console.log(`    Status  : ${log.status === 'answered' ? 'ANSWERED' : 'HANDED OFF'}`);
    console.log(`    Matched : "${log.matched_faq || 'None'}" (Score: ${log.score})`);
    console.log(`    LLM Used: ${log.llm_used ? 'YES' : 'NO'}`);
  });

  console.log('\n================================================================');
  console.log('SIMULATOR RUN COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
  process.exit(0);
}

runLocalCallSimulator().catch((err) => {
  console.error('\n[SIMULATOR FAILED]:', err);
  process.exit(1);
});
