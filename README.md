# AI College Admission Enquiry Assistant Backend

A high-performance Node.js backend using Express and ES modules for an AI Admission Enquiry Assistant. It performs semantic matching against university FAQs using a completely free, local multilingual embedding model (**Hugging Face Transformers.js with `Xenova/multilingual-e5-small`**). No external or paid APIs are required.

Supports user queries in:
- **English**
- **Hindi (Devanagari script)**
- **Hinglish (Hindi written in Latin script)**

---

## Features

- **Express & ES Modules**: Modern Node.js setup using native ESM (`import`/`export`).
- **Clean FAQ Pipeline**: Reads raw admission FAQ data from `MMMUT_Admission_Enquiry_QA.xlsx` and converts it into a clean `faq.json` (`question` and `answer` schema).
- **Local Multilingual Semantic Search**: Uses `Xenova/multilingual-e5-small` onnx runtime via `@xenova/transformers`.
- **Pre-computed In-Memory Embeddings**: All FAQ questions are embedded once at server startup and cached in memory. Incoming enquiries are matched in milliseconds.
- **Configurable Staff Handoff**: If the highest semantic similarity score falls below `SIMILARITY_THRESHOLD` configured in `.env`, the assistant returns `handoff: true` with a polite message connecting the applicant to human admission staff.
- **Console Tuning Logs**: Every user question, matched FAQ, and similarity score is printed to the server console for easy tuning.

---

## Project Structure

```
adimission/
├── .env                              # Active environment configuration
├── .env.example                      # Production template with comments for every setting
├── .gitignore                        # Git ignore (.env, node_modules, logs, cache)
├── faq.json                          # Clean JSON containing 100 FAQ question-answer pairs
├── MMMUT_Admission_Enquiry_QA.xlsx   # Original source FAQ spreadsheet
├── package.json                      # Project dependencies & scripts
├── README.md                         # Project documentation
├── server.js                         # Application entry point & process lifecycle
├── public/                           # Voice Web UI (HTML, CSS, JS with Web Speech API)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── app.js                        # Express setup, middleware, and route mounting
│   ├── config/
│   │   └── index.js                  # Type-safe centralized config loader
│   ├── services/
│   │   ├── matchingService.js        # Core unified matching engine (Web, Telephony, Admin)
│   │   ├── embeddingService.js       # Vector embeddings (local Transformers.js or cloud)
│   │   ├── databaseService.js        # Data layer (JSON, SQLite, MongoDB, Postgres)
│   │   └── telephonyService.js       # Call routing & staff handoff (Mock, Twilio, Exotel)
│   ├── routes/
│   │   ├── index.js                  # Master router
│   │   ├── askRoutes.js              # POST /ask handler
│   │   ├── healthRoutes.js           # GET /health diagnostics handler
│   │   └── adminRoutes.js            # GET /admin monitoring handler
│   ├── middleware/
│   │   ├── rateLimiter.js            # In-memory sliding window rate limiter
│   │   ├── validator.js              # Request validation & sanitization
│   │   └── errorHandler.js           # 404 catcher & global error recovery
│   └── utils/
│       └── logger.js                 # Structured console logger
├── tests/                            # Test suite & benchmark datasets
│   ├── testQuestions.json
│   ├── test-threshold.js
│   └── test-ask.js
└── scripts/
    └── convert-faq.js                # Excel to faq.json conversion script
```

---

## Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher

---

## Installation & Setup

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Check or create `.env` in the root directory:
   ```env
   PORT=3000
   SIMILARITY_THRESHOLD=0.82
   ```

3. **Convert FAQ Excel to `faq.json`**:
   To regenerate `faq.json` from `MMMUT_Admission_Enquiry_QA.xlsx`:
   ```bash
   npm run convert
   ```

---

## Running the Server

Start the backend:
```bash
npm start
```

For development mode with automatic restarts on file changes:
```bash
npm run dev
```

### Server Startup Output
When the server starts:
1. It loads the `Xenova/multilingual-e5-small` model into memory.
2. It embeds all 100 FAQ questions.
3. It listens for incoming HTTP requests on the specified port.

---

## Testing with Sample Questions

While the server is running in another terminal, run the automated test suite:
```bash
npm run test-ask
```

This sends 5 test cases:
1. **English Direct Match**: e.g., *"What courses are offered by the university?"*
2. **English Rephrased Enquiry**: e.g., *"Can you tell me how to apply for admission online?"*
3. **Hinglish Enquiry**: e.g., *"Hostel accommodation mil sakti hai kya aur hostel ki fee kitni hai?"*
4. **Pure Hindi Enquiry**: e.g., *"प्रवेश के लिए न्यूनतम प्रतिशत क्या होना चाहिए?"*
5. **Out-of-Domain Enquiry (Below Threshold)**: e.g., *"Can you recommend a good recipe for chocolate cake and who won the World Cup?"*

---

## API Reference

### `POST /ask`
Submits an applicant's query and returns the best-matching FAQ answer or triggers staff handoff.

#### Request Header
```
Content-Type: application/json
```

#### Request Body
```json
{
  "question": "Admission ke liye eligibility criteria kya hai?"
}
```

#### Response (Match Found - Similarity >= Threshold)
```json
{
  "answer": "Candidates must fulfill the minimum qualification and subject criteria specified for the programme in the MMMUT admission brochure.",
  "handoff": false,
  "similarity": 0.8841,
  "threshold": 0.82,
  "matchedQuestion": "What is the eligibility criteria?"
}
```

#### Response (Handoff Triggered - Similarity < Threshold)
```json
{
  "answer": "Thank you for contacting admission support. I couldn't find a confident answer to your question in our FAQ. We will connect you to our admission staff shortly for personal assistance.",
  "handoff": true,
  "similarity": 0.7245,
  "threshold": 0.82,
  "matchedQuestion": "Can you explain the syllabus?"
}
```

---

### `GET /health`
Returns system status, active model, loaded FAQ count, and configured threshold.

#### Response
```json
{
  "status": "healthy",
  "faqCount": 100,
  "threshold": 0.82,
  "model": "Xenova/multilingual-e5-small"
}
```

---

## Tuning & Benchmarking the Similarity Threshold

Run the comprehensive benchmark evaluation suite:
```bash
npm run test-threshold
```
This tests 40 questions across 3 groups against `/ask`, prints the results table, runs a threshold sweep across 0.75 - 0.92, and analyzes accuracy.

In `.env`, adjust `SIMILARITY_THRESHOLD`:
- **Recommended (`0.86`)**: Empirically proven optimal balance (95.0% accuracy across all test categories). It answers 100% of reworded FAQ questions in English, Hindi, and Hinglish, blocks 100% of off-topic queries, and correctly hands off 80% of out-of-FAQ admission queries to staff.
- **Lower value (e.g. `0.80 - 0.82`)**: Allows out-of-domain / out-of-FAQ questions to match loosely with wrong FAQs.
- **Higher value (e.g. `0.88+`)**: Overly restrictive; begins rejecting genuine Hindi and Hinglish queries that should be answered.
