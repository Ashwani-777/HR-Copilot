import { describe, expect, it } from 'vitest';
import { chunkPages, chunkText, splitIntoPseudoPages } from '../../src/rag/chunker.js';
import { extractPdfPages } from '../../src/rag/extract.js';
import { makePdf } from '../helpers/pdf.js';

const sentence = (i: number) => `Sentence number ${i} explains rule ${i} of the employee handbook in plain words.`;
const longText = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => sentence(i + offset)).join(' ');

describe('chunkText', () => {
  const text = longText(60); // ~4.8k chars
  const chunks = chunkText(text, { size: 800, overlap: 150 });

  it('produces chunks no longer than the target size', () => {
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800);
  });

  it('overlaps neighbouring chunks', () => {
    for (let i = 0; i + 1 < chunks.length; i++) {
      const head = chunks[i + 1]!.slice(0, 40);
      expect(chunks[i]).toContain(head);
    }
  });

  it('covers every sentence and never starts mid-word', () => {
    for (let i = 0; i < 60; i++) expect(chunks.some((c) => c.includes(sentence(i)))).toBe(true);
    for (const c of chunks.slice(1)) expect(text).toMatch(new RegExp(`(^|\\s)${c.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('returns a single chunk for short text and nothing for empty text', () => {
    expect(chunkText('Short policy line.')).toEqual(['Short policy line.']);
    expect(chunkText('   \n\n ')).toEqual([]);
  });
});

describe('chunkPages keeps page numbers', () => {
  const pages = [
    { page: 1, text: longText(25, 0) },
    { page: 2, text: 'Page two only has this unique marker: ZEBRA-42.' },
    { page: 3, text: '' },
    { page: 4, text: longText(15, 100) },
  ];
  const chunks = chunkPages(pages);

  it('tags every chunk with the page it came from (chunks never span pages)', () => {
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2, 4]));
    const zebra = chunks.filter((c) => c.content.includes('ZEBRA-42'));
    expect(zebra).toHaveLength(1);
    expect(zebra[0]!.page).toBe(2);
    for (const c of chunks.filter((x) => x.page === 1)) expect(c.content).not.toContain('Sentence number 100');
    for (const c of chunks.filter((x) => x.page === 4)) expect(c.content).toContain('Sentence number 1');
  });

  it('numbers chunks sequentially across the document', () => {
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
  });
});

describe('pseudo-pages for .md/.txt', () => {
  it('splits ~3000-char pages at paragraph boundaries, numbered from 1', () => {
    const paragraphs = Array.from({ length: 14 }, (_, i) => `Paragraph ${i}. ${longText(6, i * 10)}`);
    const pages = splitIntoPseudoPages(paragraphs.join('\n\n'));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.map((p) => p.page)).toEqual(pages.map((_, i) => i + 1));
    for (const p of pages) expect(p.text.length).toBeLessThanOrEqual(3000 + 600);
    const joined = pages.map((p) => p.text).join('\n\n');
    for (const para of paragraphs) expect(joined).toContain(para);
  });
});

describe('PDF extraction', () => {
  it('extracts text per page and the chunker keeps those page numbers', async () => {
    const pdf = makePdf([
      ['Leave policy page one.', 'Casual leave is 12 days per year.'],
      ['Attendance page two.', 'Check-ins after 09:30 are marked late.'],
      ['Holidays page three.'],
    ]);
    const pages = await extractPdfPages(pdf);
    expect(pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(pages[0]!.text).toContain('Casual leave is 12 days per year.');
    expect(pages[1]!.text).toContain('marked late');
    expect(pages[0]!.text).not.toContain('marked late');

    const chunks = chunkPages(pages);
    expect(chunks.find((c) => c.content.includes('09:30'))!.page).toBe(2);
  });
});
