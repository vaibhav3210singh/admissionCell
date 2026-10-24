import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const excelFilePath = path.resolve(__dirname, '../MMMUT_Admission_Enquiry_QA.xlsx');
const outputJsonPath = path.resolve(__dirname, '../faq.json');

console.log(`Reading FAQ data from: ${excelFilePath}`);

if (!fs.existsSync(excelFilePath)) {
  console.error(`Error: Excel file not found at ${excelFilePath}`);
  process.exit(1);
}

const workbook = xlsx.readFile(excelFilePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const rows = xlsx.utils.sheet_to_json(sheet);

console.log(`Found ${rows.length} rows in sheet '${sheetName}'.`);

const cleanFaq = [];

for (const row of rows) {
  const question = row['Admission Enquiry Question']?.toString().trim();
  const answer = row['Answer']?.toString().trim();

  if (question && answer) {
    cleanFaq.push({
      question,
      answer
    });
  }
}

fs.writeFileSync(outputJsonPath, JSON.stringify(cleanFaq, null, 2), 'utf-8');

console.log(`Successfully converted ${cleanFaq.length} FAQs to ${outputJsonPath}`);
