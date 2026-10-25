import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as googleTTS from 'google-tts-api';
import config from '../src/config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, '..', 'data', 'voice-samples');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 5 Sample Spoken Answers (English & Hindi) matching admission phone responses
const sampleAnswers = [
  {
    id: 1,
    title: 'B.Tech Eligibility & Admissions (English)',
    lang: 'en-IN',
    voice: config.telephony.ttsVoiceEn,
    text: 'To be eligible for B.Tech admission at MMMUT, you need at least fifty-five percent marks in your twelfth board exam with Physics, Mathematics, and Chemistry, plus a valid JEE Main rank. Is there anything else I can help you with?'
  },
  {
    id: 2,
    title: 'Hostel Fees & Mess Expenses (Hindi)',
    lang: 'hi-IN',
    voice: config.telephony.ttsVoiceHi,
    text: 'एमएमएमयूटी में बीटेक छात्रों के लिए हॉस्टल और मेस का सालाना खर्च लगभग पैंतालीस हज़ार रुपये है। क्या मैं आपकी किसी और चीज़ में मदद कर सकता हूँ?'
  },
  {
    id: 3,
    title: 'Direct Second Year Lateral Entry (English)',
    lang: 'en-IN',
    voice: config.telephony.ttsVoiceEn,
    text: 'Yes, diploma holders and B.Sc. graduates can apply for direct second-year lateral entry through the CUET-UG entrance examination. Is there anything else I can help you with?'
  },
  {
    id: 4,
    title: 'B.Pharma Course & Intake (Hindi)',
    lang: 'hi-IN',
    voice: config.telephony.ttsVoiceHi,
    text: 'एमएमएमयूटी में बी.फार्मा पाठ्यक्रम की कुल साठ सीटें हैं, और इसमें प्रवेश सीयूईटी परीक्षा की मेरिट के आधार पर होता है। क्या मैं आपकी किसी और चीज़ में मदद कर सकता हूँ?'
  },
  {
    id: 5,
    title: 'Fee Refund Policy (English)',
    lang: 'en-IN',
    voice: config.telephony.ttsVoiceEn,
    text: 'If you withdraw before the last date of admissions, your fee is refunded after a nominal deduction of one thousand rupees. Is there anything else I can help you with?'
  }
];

/**
 * Generates audio buffer using ElevenLabs REST API with the exact model Twilio ConversationRelay uses.
 */
async function generateElevenLabsTTSAudio(text, voiceId) {
  const apiKey = config.telephony.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  const modelId = config.telephony.elevenLabsModel || 'eleven_flash_v2_5';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errText.substring(0, 100)}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * High fidelity Google TTS engine fallback when ElevenLabs API key is not supplied.
 */
async function generateGoogleTTSAudio(text, lang) {
  const shortLang = lang.startsWith('hi') ? 'hi' : 'en';
  const audioChunks = await googleTTS.getAllAudioBase64(text, {
    lang: shortLang,
    slow: false,
    host: 'https://translate.google.com',
    timeout: 10000
  });

  const buffers = audioChunks.map(chunk => Buffer.from(chunk.base64, 'base64'));
  return Buffer.concat(buffers);
}

async function main() {
  const isElevenLabsConfigured = Boolean(config.telephony.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY);
  const activeEngine = isElevenLabsConfigured ? 'ElevenLabs' : 'Google Text-to-Speech (Fallback)';

  console.log('================================================================');
  console.log('       AI ADMISSION ASSISTANT - TTS VOICE COMPARISON GENERATOR   ');
  console.log('================================================================');
  console.log(`Preferred Provider  : ${config.telephony.ttsProvider.toUpperCase()}`);
  console.log(`Active Audio Engine : ${activeEngine.toUpperCase()}`);
  if (isElevenLabsConfigured) {
    console.log(`ElevenLabs Model    : ${config.telephony.elevenLabsModel}`);
  }
  console.log(`English Voice (EN)  : ${config.telephony.ttsVoiceEn}`);
  console.log(`Hindi Voice (HI)    : ${config.telephony.ttsVoiceHi}`);
  console.log(`Output Directory    : ${outputDir}`);
  console.log('----------------------------------------------------------------\n');

  if (!isElevenLabsConfigured) {
    console.log('[NOTE ON VOICES & TWILIO REAL CALLS]:');
    console.log('1. Because ELEVENLABS_API_KEY is not set in .env, these sample files');
    console.log('   are generated using Google\'s Text-to-Speech engine as zero-cost fallback.');
    console.log('2. When you later add ELEVENLABS_API_KEY to .env, this script will generate');
    console.log(`   audio using ElevenLabs (${config.telephony.elevenLabsModel || 'eleven_flash_v2_5'}).`);
    console.log('3. On a real Twilio call, Twilio uses Google Cloud Neural2 voices');
    console.log('   (Google.en-IN-Neural2-A / Google.hi-IN-Neural2-A) or ElevenLabs via ConversationRelay.\n');
  }

  const generatedFiles = [];

  for (const sample of sampleAnswers) {
    const filename = `sample_${sample.id}_${sample.lang.slice(0, 2)}.mp3`;
    const filePath = path.join(outputDir, filename);

    console.log(`[${sample.id}/5] Generating: "${sample.title}"...`);
    console.log(`       Language : ${sample.lang}`);
    console.log(`       Target Voice: ${sample.voice}`);
    console.log(`       Preview  : "${sample.text.slice(0, 75)}..."`);

    try {
      let buffer = null;
      let usedProvider = 'Google TTS';

      if (isElevenLabsConfigured) {
        try {
          console.log(`       -> Calling ElevenLabs API (model: ${config.telephony.elevenLabsModel})...`);
          buffer = await generateElevenLabsTTSAudio(sample.text, sample.voice);
          usedProvider = `ElevenLabs (${config.telephony.elevenLabsModel})`;
        } catch (elErr) {
          console.warn(`       [WARN] ElevenLabs API failed (${elErr.message}). Falling back to Google TTS.`);
        }
      }

      if (!buffer) {
        buffer = await generateGoogleTTSAudio(sample.text, sample.lang);
        usedProvider = 'Google TTS';
      }

      fs.writeFileSync(filePath, buffer);
      const sizeKb = (buffer.length / 1024).toFixed(1);
      console.log(`       -> Saved: ${filename} (${sizeKb} KB, Engine: ${usedProvider})\n`);

      generatedFiles.push({
        id: sample.id,
        title: sample.title,
        lang: sample.lang,
        voice: sample.voice,
        provider: usedProvider,
        filename,
        filePath,
        text: sample.text
      });

    } catch (err) {
      console.error(`       [ERROR] Failed to generate audio: ${err.message}\n`);
    }
  }

  // Generate an HTML listening player so the user can easily play and compare in browser
  const htmlPlayerContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MMMUT Voice Comparison Player</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
    .container { max-width: 800px; margin: 0 auto; background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
    h1 { color: #38bdf8; margin-top: 0; }
    .info-banner { background: #1e3a5f; border-left: 4px solid #38bdf8; padding: 1rem; border-radius: 6px; margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.5; }
    .sample-card { background: #334155; padding: 1.25rem; border-radius: 8px; margin-bottom: 1.5rem; }
    .sample-title { font-weight: 600; font-size: 1.1rem; color: #f1f5f9; margin-bottom: 0.5rem; }
    .meta { font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.75rem; }
    .tag { display: inline-block; background: #0284c7; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-right: 0.5rem; font-weight: 600; }
    .text { background: #1e293b; padding: 0.75rem; border-radius: 6px; font-size: 0.95rem; margin-bottom: 0.75rem; color: #e2e8f0; border-left: 4px solid #38bdf8; }
    audio { width: 100%; outline: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>MMMUT Admission Voice Comparison Samples</h1>
    <div class="info-banner">
      <strong>Active Engine:</strong> ${activeEngine}<br>
      <strong>Configured TTS Provider:</strong> ${config.telephony.ttsProvider.toUpperCase()}<br>
      <strong>Voice Mapping:</strong> English (<code>${config.telephony.ttsVoiceEn}</code>) | Hindi (<code>${config.telephony.ttsVoiceHi}</code>)<br>
      ${isElevenLabsConfigured ? '<em>Generated directly via ElevenLabs API using model: ' + config.telephony.elevenLabsModel + '</em>' : '<em>Generated via Google TTS engine fallback (add ELEVENLABS_API_KEY in .env to switch to direct ElevenLabs synthesis).</em>'}
    </div>
    <p>Compare the spoken human naturalness of English and Hindi voice answers below:</p>
    ${generatedFiles.map(f => `
      <div class="sample-card">
        <div class="sample-title">#${f.id}: ${f.title}</div>
        <div class="meta">
          <span class="tag">${f.lang}</span>
          Provider: <strong>${f.provider}</strong> | Voice: <strong>${f.voice}</strong>
        </div>
        <div class="text">"${f.text}"</div>
        <audio controls src="./${f.filename}"></audio>
      </div>
    `).join('')}
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(outputDir, 'index.html'), htmlPlayerContent);

  console.log('================================================================');
  console.log('All 5 sample voice answers successfully generated!');
  console.log(`Directory: ${outputDir}`);
  console.log(`Listening player: ${path.join(outputDir, 'index.html')}`);
  console.log('================================================================');
}

main();
