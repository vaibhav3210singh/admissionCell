import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}/ask`;

const sampleQuestions = [
  {
    type: 'English Direct Match',
    question: 'What courses are offered by the university?'
  },
  {
    type: 'English Rephrased Query',
    question: 'Can you tell me how to apply for admission online?'
  },
  {
    type: 'Hinglish Query (Latin Hindi)',
    question: 'Hostel accommodation mil sakti hai kya aur hostel ki fee kitni hai?'
  },
  {
    type: 'Pure Hindi Query (Devanagari)',
    question: 'प्रवेश के लिए न्यूनतम प्रतिशत क्या होना चाहिए?'
  },
  {
    type: 'Out-of-Domain Query (Below Threshold)',
    question: 'Can you recommend a good recipe for chocolate cake and who won the World Cup?'
  }
];

async function runTests() {
  console.log(`\n======================================================`);
  console.log(` Running 5 Sample Test Enquiries against ${URL}`);
  console.log(`======================================================\n`);

  for (let i = 0; i < sampleQuestions.length; i++) {
    const item = sampleQuestions[i];
    console.log(`[Test ${i + 1}/5] Category: ${item.type}`);
    console.log(`Query: "${item.question}"`);

    try {
      const response = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: item.question })
      });

      if (!response.ok) {
        console.error(`HTTP Error: ${response.status} ${response.statusText}`);
        const errText = await response.text();
        console.error(errText);
        continue;
      }

      const result = await response.json();
      console.log('Result:');
      console.log(`  - Matched FAQ : "${result.matchedQuestion}"`);
      console.log(`  - Similarity  : ${result.similarity} (Threshold: ${result.threshold})`);
      console.log(`  - Handoff     : ${result.handoff ? 'YES (Handed off to staff)' : 'NO (Answered from FAQ)'}`);
      console.log(`  - Answer      : "${result.answer}"`);
      console.log('------------------------------------------------------\n');
    } catch (err) {
      console.error(`Error executing test ${i + 1}:`, err.message);
    }
  }
}

runTests();
