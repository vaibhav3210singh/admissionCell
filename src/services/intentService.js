/**
 * Intent detection utility for identifying explicit caller requests
 * to transfer to human staff, operator, or live admission representative.
 */

const ENGLISH_HUMAN_TRIGGERS = [
  'human',
  'operator',
  'staff',
  'agent',
  'representative',
  'real person',
  'live person',
  'speak to someone',
  'talk to someone',
  'speak with someone',
  'talk with someone',
  'connect to staff',
  'connect to human',
  'transfer to human',
  'transfer to staff',
  'transfer to operator',
  'call executive',
  'admission officer',
  'helpdesk person'
];

const HINDI_HUMAN_TRIGGERS = [
  'baat karao',
  'baat karwao',
  'baat karni hai',
  'insaan se baat',
  'insan se baat',
  'kisi se baat',
  'staff se baat',
  'operator se baat',
  'agent se baat',
  'adhikari se baat',
  'sir se baat',
  'madam se baat',
  'human se baat',
  'call transfer karo',
  'line connect karo',
  'kisi vyakti se baat',
  'live agent',
  'manav se baat'
];

/**
 * Checks if the caller utterance explicitly requests a human operator or staff transfer.
 * @param {string} text - Caller speech input
 * @returns {boolean}
 */
export function isExplicitHumanHandoffRequest(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.toLowerCase().replace(/[.,!?;:'"()]/g, ' ').trim();

  // 1. Direct phrase matching for multi-word intents
  for (const phrase of HINDI_HUMAN_TRIGGERS) {
    if (clean.includes(phrase)) return true;
  }
  for (const phrase of ENGLISH_HUMAN_TRIGGERS) {
    if (clean.includes(phrase)) return true;
  }

  // 2. Check for single strong keywords in token array
  const words = clean.split(/\s+/).filter(Boolean);
  const strongKeywords = new Set([
    'operator', 'human', 'representative'
  ]);

  if (words.some(w => strongKeywords.has(w))) {
    return true;
  }

  // 3. Devanagari script intent check
  const devanagariTriggers = [
    'इंसान से बात', 'बात कराओ', 'बात करवाओ', 'स्टाफ से बात',
    'ऑपरेटर से बात', 'अधिकारी से बात', 'व्यक्ति से बात'
  ];
  for (const devPhrase of devanagariTriggers) {
    if (text.includes(devPhrase)) return true;
  }

  return false;
}

export default {
  isExplicitHumanHandoffRequest
};
