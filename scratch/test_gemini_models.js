import config from '../src/config/index.js';

async function testModels() {
  const apiKey = config.llm.geminiApiKey;
  const models = [
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite'
  ];

  for (const m of models) {
    const t0 = Date.now();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Answer in 5 words: What is MMMUT?' }] }]
        })
      });
      const t1 = Date.now();
      const data = await res.json();
      console.log(`Model: ${m} | Status: ${res.status} | Latency: ${t1 - t0}ms`);
      if (res.status !== 200) {
        console.log('  Error:', data.error?.message || data);
      } else {
        console.log('  Text:', data.candidates?.[0]?.content?.parts?.[0]?.text?.trim());
      }
    } catch (err) {
      console.log(`Model: ${m} | Error: ${err.message}`);
    }
  }
}

testModels().catch(console.error);
