import { readFile } from 'node:fs/promises';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { normalizeText, splitIntoPseudoPages, type PageText } from './chunker.js';

interface PdfTextItem {
  str: string;
  transform: number[];
}
interface PdfPage {
  pageIndex?: number;
  pageNumber?: number;
  getTextContent(opts: { normalizeWhitespace: boolean; disableCombineTextItems: boolean }): Promise<{ items: PdfTextItem[] }>;
}

/** Extract PDF text page by page (pdf-parse `pagerender` hook), keeping 1-based page numbers. */
export async function extractPdfPages(buffer: Buffer): Promise<PageText[]> {
  // Hand pdf.js a plain, exact-size Uint8Array. A Node Buffer can be a view into a shared 8 KB pool
  // (small files), and pdf.js reads the whole underlying ArrayBuffer → "bad XRef entry".
  const data = new Uint8Array(buffer) as unknown as Buffer;
  const pages: PageText[] = [];
  await pdf(data, {
    pagerender: async (pageData: PdfPage) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      let lastY: number | undefined;
      let text = '';
      for (const item of content.items) {
        const y = item.transform[5];
        text += lastY === undefined || y === lastY ? item.str : `\n${item.str}`;
        lastY = y;
      }
      const page = pageData.pageNumber ?? (pageData.pageIndex ?? pages.length) + 1;
      pages.push({ page, text: normalizeText(text) });
      return text;
    },
  } as Parameters<typeof pdf>[1]);
  return pages.sort((a, b) => a.page - b.page);
}

export async function extractPages(filePath: string, mimeType: string): Promise<PageText[]> {
  const buffer = await readFile(filePath);
  if (mimeType === 'application/pdf') return extractPdfPages(buffer);
  // .md / .txt → pseudo-pages of ~3000 chars
  return splitIntoPseudoPages(buffer.toString('utf8'));
}
