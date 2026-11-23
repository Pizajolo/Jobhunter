import { extractText, getDocumentProxy } from 'unpdf';
import mammoth from 'mammoth';

export class UnsupportedFileError extends Error {}

/** Plain text from an uploaded CV (PDF or DOCX). Images are ignored; scanned PDFs yield little text. */
export async function extractCvText(buf: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  let text: string;
  if (lower.endsWith('.pdf') || buf.subarray(0, 5).toString() === '%PDF-') {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const res = await extractText(pdf, { mergePages: true });
    text = Array.isArray(res.text) ? res.text.join('\n') : res.text;
  } else if (lower.endsWith('.docx')) {
    text = (await mammoth.extractRawText({ buffer: buf })).value;
  } else if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    text = buf.toString('utf8');
  } else {
    throw new UnsupportedFileError('Upload a PDF or DOCX file.');
  }
  return text
    .replace(/\r/gu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
