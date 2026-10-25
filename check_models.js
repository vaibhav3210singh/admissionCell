import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY;

async function checkModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.models) {
    console.log('Available models:');
    data.models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .forEach(m => console.log(`- ${m.name} (${m.displayName})`));
  } else {
    console.log('Error:', data);
  }
}

checkModels();
