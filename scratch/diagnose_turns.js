import databaseService from '../src/services/databaseService.js';
import { initializeEmbeddingService, findTopMatchingFAQs } from '../src/services/embeddingService.js';
import matchingService from '../src/services/matchingService.js';
import config from '../src/config/index.js';

async function diagnose() {
  await databaseService.initialize();
  await initializeEmbeddingService();

  const testQuestions = [
    { turn: 1, type: 'English FAQ Query', callerSpeech: 'What is the eligibility criteria for admission?' },
    { turn: 2, type: 'Hindi FAQ Query', callerSpeech: 'हॉस्टल की सालाना फीस कितनी है?' },
    { turn: 3, type: 'Hinglish FAQ Query', callerSpeech: 'Application form submit karne ki last date kya hai?' },
    { turn: 4, type: 'Out-of-FAQ Handoff', callerSpeech: 'Can single girl children get a fee waiver for admission?' },
    { turn: 5, type: 'English FAQ Query', callerSpeech: 'What courses are offered by the university?' },
    { turn: 6, type: 'Hindi FAQ Query', callerSpeech: 'क्या विश्वविद्यालय में बीटेक के लिए लेटरल एंट्री मिलती है?' },
    { turn: 7, type: 'Hinglish FAQ Query', callerSpeech: 'BTech first year ki total fees kitni padegi?' },
    { turn: 8, type: 'Out-of-FAQ Handoff', callerSpeech: 'Is there any uniform or mandatory dress code for freshers?' },
    { turn: 9, type: 'English FAQ Query', callerSpeech: 'How can I apply for admission?' },
    { turn: 10, type: 'Hindi FAQ Query', callerSpeech: 'एडमिशन के लिए कौन-कौन से दस्तावेज चाहिए?' },
    { turn: 11, type: 'Hinglish FAQ Query', callerSpeech: 'Hostel sabhi students ke liye compulsory hota hai kya?' },
    { turn: 12, type: 'Out-of-FAQ Handoff', callerSpeech: 'Are there reserved seats for wards of defense personnel?' },
    { turn: 13, type: 'English FAQ Query', callerSpeech: 'Is the admission fee refundable?' },
    { turn: 14, type: 'Hindi FAQ Query', callerSpeech: 'क्या विश्वविद्यालय में छात्रों को छात्रवृत्ति मिलती है?' },
    { turn: 15, type: 'Hinglish FAQ Query', callerSpeech: 'Direct admission mil sakta hai kya management quota se?' },
    { turn: 16, type: 'Out-of-FAQ Handoff', callerSpeech: 'What is the special reservation policy for Kashmiri migrants?' },
    { turn: 17, type: 'English FAQ Query', callerSpeech: 'What is the placement record of the university?' },
    { turn: 18, type: 'Hindi FAQ Query', callerSpeech: 'एमबीए कोर्स में एडमिशन का क्या प्रोसेस है?' },
    { turn: 19, type: 'Out-of-FAQ Handoff', callerSpeech: 'Entrance exam center admit card aane ke baad change ho sakta hai kya?' },
    { turn: 20, type: 'English FAQ Query', callerSpeech: 'Where is the university campus located and how can I reach there?' }
  ];

  console.log('TURN DIAGNOSTIC RESULTS:');
  const details = [];

  for (const t of testQuestions) {
    const top = await findTopMatchingFAQs(t.callerSpeech, 3);
    const best = top[0];
    const score = Number(best.similarity.toFixed(4));
    const threshold = config.matching.similarityThreshold;
    const isAbove = score >= threshold;

    let reason = '';
    if (!isAbove) {
      reason = 'below_threshold';
    } else {
      reason = 'above_threshold_sent_to_llm';
    }

    details.push({
      turn: t.turn,
      type: t.type,
      question: t.callerSpeech,
      matchedFaq: best.question,
      score,
      threshold,
      isAbove,
      initialReason: reason
    });
  }

  console.log(JSON.stringify(details, null, 2));
}

diagnose().catch(console.error);
