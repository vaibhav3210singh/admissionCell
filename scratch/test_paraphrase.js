import { pipeline } from '@xenova/transformers';

async function testParaphrase() {
  const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');

  const query = 'query: क्या विश्वविद्यालय में छात्रों को छात्रवृत्ति मिलती है?';
  const doc1 = 'passage: Are scholarships available?';
  const doc2 = 'passage: Are scholarships available? क्या विश्वविद्यालय में छात्रों को छात्रवृत्ति मिलती है?';
  const doc3 = 'passage: Are scholarships available for students? छात्रवृत्ति की सुविधा उपलब्ध है?';

  const qEmb = await extractor(query, { pooling: 'mean', normalize: true });
  const d1Emb = await extractor(doc1, { pooling: 'mean', normalize: true });
  const d2Emb = await extractor(doc2, { pooling: 'mean', normalize: true });
  const d3Emb = await extractor(doc3, { pooling: 'mean', normalize: true });

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  console.log('Original English Doc Score:', dot(qEmb.data, d1Emb.data));
  console.log('Bilingual Doc 2 Score     :', dot(qEmb.data, d2Emb.data));
  console.log('Bilingual Doc 3 Score     :', dot(qEmb.data, d3Emb.data));
}

testParaphrase().catch(console.error);
