/**
 * AI Admission Voice Assistant - Frontend Client
 * Handles Web Speech Recognition (STT), Backend /ask Integration, and SpeechSynthesis (TTS).
 */

// Application State
let currentLang = 'en-IN';
let recognition = null;
let isListening = false;
let currentUtterance = null;
let lastAnswerText = '';

// DOM Elements
const micButton = document.getElementById('micButton');
const micButtonWrapper = document.querySelector('.mic-button-wrapper');
const micStatusText = document.getElementById('micStatusText');
const micSubhint = document.getElementById('micSubhint');
const voiceControls = document.getElementById('voiceControls');
const stopListeningBtn = document.getElementById('stopListeningBtn');
const stopSpeechBtn = document.getElementById('stopSpeechBtn');
const replaySpeechBtn = document.getElementById('replaySpeechBtn');

const langEnBtn = document.getElementById('langEnBtn');
const langHiBtn = document.getElementById('langHiBtn');

const transcriptSection = document.getElementById('transcriptSection');
const transcriptText = document.getElementById('transcriptText');
const transcriptStatus = document.getElementById('transcriptStatus');

const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const chipsContainer = document.getElementById('chipsContainer');

const loaderBox = document.getElementById('loaderBox');
const resultSection = document.getElementById('resultSection');
const answerCard = document.getElementById('answerCard');
const handoffCard = document.getElementById('handoffCard');

const answerScoreBadge = document.getElementById('answerScoreBadge');
const matchedFaqTitle = document.getElementById('matchedFaqTitle');
const answerText = document.getElementById('answerText');
const handoffScoreText = document.getElementById('handoffScoreText');
const handoffMessageText = document.getElementById('handoffMessageText');

const serverStatusBadge = document.getElementById('serverStatusBadge');
const serverStatusText = document.getElementById('serverStatusText');
const browserWarning = document.getElementById('browserWarning');

// Localized UI strings
const i18n = {
  'en-IN': {
    micPrompt: 'Tap microphone and ask your admission query',
    micListening: 'Listening... Please speak your question now',
    micProcessing: 'Processing your question...',
    subhint: 'Supports English, pure Hindi (Devanagari), and Hinglish',
    placeholder: 'Or type your question here (e.g. hostel fee, eligibility)...',
    recStatusListening: 'Listening...',
    recStatusCaptured: 'Speech captured',
    readAloud: 'Read Aloud'
  },
  'hi-IN': {
    micPrompt: 'माइक पर टैप करें और अपना प्रवेश सम्बन्धी प्रश्न पूछें',
    micListening: 'सुन रहे हैं... कृपया अपना प्रश्न बोलें',
    micProcessing: 'आपके प्रश्न का उत्तर खोजा जा रहा है...',
    subhint: 'अंग्रेजी, शुद्ध हिन्दी और हिंग्लिश सभी भाषाएँ समर्थित हैं',
    placeholder: 'या अपना प्रश्न यहाँ लिखें (उदा. छात्रावास शुल्क, योग्यता)...',
    recStatusListening: 'सुन रहे हैं...',
    recStatusCaptured: 'आवाज़ दर्ज हो गई',
    readAloud: 'बोलकर सुनाएं'
  }
};

/**
 * Initialize Speech Recognition
 */
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('Web Speech Recognition API is not supported in this browser.');
    browserWarning.style.display = 'flex';
    micStatusText.textContent = 'Speech recognition not supported in this browser';
    micSubhint.textContent = 'Please use Google Chrome or Microsoft Edge, or type your question below.';
    micButton.style.opacity = '0.6';
    micButton.style.cursor = 'not-allowed';
    return;
  }

  try {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = currentLang;

    recognition.onstart = () => {
      isListening = true;
      micButtonWrapper.classList.add('listening');
      micStatusText.textContent = i18n[currentLang].micListening;
      stopListeningBtn.style.display = 'inline-flex';
      voiceControls.style.display = 'flex';
      transcriptSection.style.display = 'block';
      transcriptStatus.textContent = i18n[currentLang].recStatusListening;
      transcriptText.innerHTML = '<span class="interim">...</span>';
      stopSpeech();
    };

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcriptPart = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcriptPart;
        } else {
          interim += transcriptPart;
        }
      }

      if (final) {
        transcriptText.textContent = final;
        transcriptStatus.textContent = i18n[currentLang].recStatusCaptured;
      } else if (interim) {
        transcriptText.innerHTML = `<span class="interim">${interim}</span>`;
      }
    };

    recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      isListening = false;
      micButtonWrapper.classList.remove('listening');
      stopListeningBtn.style.display = 'none';

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        micStatusText.textContent = 'Microphone permission denied';
        micSubhint.textContent = 'Please allow microphone access in your browser address bar.';
      } else if (event.error === 'no-speech') {
        micStatusText.textContent = 'No speech detected';
        micSubhint.textContent = 'Please tap the microphone and try speaking again.';
      } else {
        micStatusText.textContent = `Recognition error: ${event.error}`;
      }
    };

    recognition.onend = () => {
      isListening = false;
      micButtonWrapper.classList.remove('listening');
      stopListeningBtn.style.display = 'none';

      const capturedQuery = transcriptText.textContent.trim();
      if (capturedQuery && capturedQuery !== '...') {
        micStatusText.textContent = i18n[currentLang].micProcessing;
        submitQuery(capturedQuery);
      } else {
        micStatusText.textContent = i18n[currentLang].micPrompt;
      }
    };
  } catch (err) {
    console.error('Failed to initialize speech recognition:', err);
  }
}

/**
 * Toggle Microphone Listening
 */
function toggleListening() {
  if (!recognition) {
    initSpeechRecognition();
    if (!recognition) {
      textInput.focus();
      return;
    }
  }

  if (isListening) {
    recognition.stop();
  } else {
    recognition.lang = currentLang;
    try {
      recognition.start();
    } catch (err) {
      console.error('Error starting recognition:', err);
    }
  }
}

/**
 * Text-to-Speech Output
 */
function speakAnswer(text, lang) {
  if (!('speechSynthesis' in window)) {
    console.warn('Web SpeechSynthesis API is not supported in this browser.');
    return;
  }

  stopSpeech();

  lastAnswerText = text;
  currentUtterance = new SpeechSynthesisUtterance(text);
  currentUtterance.lang = lang;
  currentUtterance.rate = 0.98;
  currentUtterance.pitch = 1.0;

  // Attempt to select an authentic native voice for the selected language
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const targetPrefix = lang.split('-')[0].toLowerCase();
    const matchedVoice = voices.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(targetPrefix)) ||
                         voices.find(v => v.lang.toLowerCase().includes(targetPrefix));
    if (matchedVoice) {
      currentUtterance.voice = matchedVoice;
    }
  }

  currentUtterance.onstart = () => {
    stopSpeechBtn.style.display = 'inline-flex';
    voiceControls.style.display = 'flex';
  };

  currentUtterance.onend = () => {
    stopSpeechBtn.style.display = 'none';
  };

  currentUtterance.onerror = () => {
    stopSpeechBtn.style.display = 'none';
  };

  window.speechSynthesis.speak(currentUtterance);
}

function stopSpeech() {
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  stopSpeechBtn.style.display = 'none';
}

/**
 * Send query to /ask backend endpoint
 */
async function submitQuery(queryText) {
  if (!queryText || !queryText.trim()) return;

  const trimmed = queryText.trim();

  // Show user question in transcript
  transcriptSection.style.display = 'block';
  transcriptStatus.textContent = 'Enquiry Sent';
  transcriptText.textContent = `"${trimmed}"`;

  // UI loading state
  loaderBox.style.display = 'flex';
  resultSection.style.display = 'none';
  answerCard.style.display = 'none';
  handoffCard.style.display = 'none';

  try {
    const response = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: trimmed,
        language: currentLang,
        channel: 'web'
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    loaderBox.style.display = 'none';
    resultSection.style.display = 'block';
    micStatusText.textContent = i18n[currentLang].micPrompt;

    if (!data.handoff) {
      // FAQ Answer Found
      answerCard.style.display = 'flex';
      handoffCard.style.display = 'none';
      answerScoreBadge.textContent = `Similarity: ${(data.similarity * 100).toFixed(1)}% (Threshold: ${data.threshold})`;
      matchedFaqTitle.textContent = data.matchedQuestion || 'Standard FAQ Topic';
      answerText.textContent = data.answer;

      // Speak aloud in selected language
      speakAnswer(data.answer, currentLang);
    } else {
      // Staff Handoff Triggered
      answerCard.style.display = 'none';
      handoffCard.style.display = 'flex';
      handoffScoreText.textContent = `Similarity score: ${data.similarity} (Below ${data.threshold} threshold)`;
      handoffMessageText.textContent = data.answer;

      // Speak handoff explanation aloud
      speakAnswer(data.answer, currentLang);
    }
  } catch (err) {
    loaderBox.style.display = 'none';
    micStatusText.textContent = 'Failed to connect to server';
    console.error('Error querying /ask:', err);
    alert('Unable to process enquiry. Please ensure the backend server is running on http://localhost:3000.');
  }
}

/**
 * Check Backend Health
 */
async function checkHealth() {
  try {
    const res = await fetch('/health');
    if (res.ok) {
      const data = await res.json();
      serverStatusBadge.classList.add('online');
      serverStatusText.textContent = `Online • ${data.faqCount} FAQs (Threshold: ${data.threshold})`;
    } else {
      serverStatusText.textContent = 'Server Error';
    }
  } catch {
    serverStatusText.textContent = 'Offline';
  }
}

/**
 * Set Active Language
 */
function setLanguage(lang) {
  currentLang = lang;
  if (lang === 'en-IN') {
    langEnBtn.classList.add('active');
    langHiBtn.classList.remove('active');
  } else {
    langHiBtn.classList.add('active');
    langEnBtn.classList.remove('active');
  }

  // Update localized text
  const dict = i18n[currentLang];
  if (!isListening) {
    micStatusText.textContent = dict.micPrompt;
  }
  micSubhint.textContent = dict.subhint;
  textInput.placeholder = dict.placeholder;

  if (recognition) {
    recognition.lang = currentLang;
  }
}

// Event Listeners
micButton.addEventListener('click', toggleListening);
stopListeningBtn.addEventListener('click', () => {
  if (recognition && isListening) recognition.stop();
});
stopSpeechBtn.addEventListener('click', stopSpeech);
replaySpeechBtn.addEventListener('click', () => {
  if (lastAnswerText) speakAnswer(lastAnswerText, currentLang);
});

langEnBtn.addEventListener('click', () => setLanguage('en-IN'));
langHiBtn.addEventListener('click', () => setLanguage('hi-IN'));

sendBtn.addEventListener('click', () => {
  const query = textInput.value;
  if (query.trim()) {
    submitQuery(query);
    textInput.value = '';
  }
});

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const query = textInput.value;
    if (query.trim()) {
      submitQuery(query);
      textInput.value = '';
    }
  }
});

// Quick question chip clicks
chipsContainer.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip && chip.dataset.query) {
    submitQuery(chip.dataset.query);
  }
});

// Pre-load synthesis voices if available
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  initSpeechRecognition();
  checkHealth();
});
