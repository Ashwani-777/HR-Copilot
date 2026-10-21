import { describe, expect, it } from 'vitest';
import { parseBlocks, parseInline, tidyStreaming } from './markdown';

describe('parseInline', () => {
  it('parses bold, italic, code and citation markers', () => {
    expect(parseInline('You get **12 casual** leaves [1], see *policy* `§2` [2, 3].')).toEqual([
      { type: 'text', text: 'You get ' },
      { type: 'strong', children: [{ type: 'text', text: '12 casual' }] },
      { type: 'text', text: ' leaves' },
      { type: 'cite', indices: [1] },
      { type: 'text', text: ', see ' },
      { type: 'em', children: [{ type: 'text', text: 'policy' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: '§2' },
      { type: 'cite', indices: [2, 3] },
      { type: 'text', text: '.' },
    ]);
  });

  it('leaves an unclosed ** (mid-stream) as plain text', () => {
    expect(parseInline('Casual leave is **12 da')).toEqual([{ type: 'text', text: 'Casual leave is **12 da' }]);
  });

  it('only links http(s) URLs', () => {
    expect(parseInline('[site](javascript:alert(1))')).toEqual([{ type: 'text', text: '[site](javascript:alert(1))' }]);
    expect(parseInline('[site](https://acme.test)')).toEqual([
      { type: 'link', href: 'https://acme.test', children: [{ type: 'text', text: 'site' }] },
    ]);
  });
});

describe('parseBlocks', () => {
  it('parses paragraphs, lists and tables', () => {
    const md = 'Late this week:\n\n- Riya — 3 days\n- Aman — 2 days\n\n1. First\n2. Second\n\n| Name | Days |\n|---|---|\n| Riya | 3 |';
    expect(parseBlocks(md)).toEqual([
      { type: 'p', lines: ['Late this week:'] },
      { type: 'ul', items: ['Riya — 3 days', 'Aman — 2 days'] },
      { type: 'ol', start: 1, items: ['First', 'Second'] },
      { type: 'table', header: ['Name', 'Days'], rows: [['Riya', '3']] },
    ]);
  });

  it('keeps single newlines inside a paragraph as separate lines', () => {
    expect(parseBlocks('Line one\nLine two')).toEqual([{ type: 'p', lines: ['Line one', 'Line two'] }]);
  });
});

describe('tidyStreaming', () => {
  it('hides a dangling bold/code opener mid-stream but keeps balanced ones', () => {
    expect(tidyStreaming('You get **12')).toBe('You get 12');
    expect(tidyStreaming('You get **12** days and `co')).toBe('You get **12** days and co');
    expect(tidyStreaming('Done **ok**')).toBe('Done **ok**');
  });
});
