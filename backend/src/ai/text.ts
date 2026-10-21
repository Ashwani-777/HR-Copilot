/** Tiny English text analysis shared by the mock embedder and the mock chat model. */

const STOPWORDS = new Set(
  (
    'a an the and or but if then else of to in on at by for with from into onto about over under as is are was were be been being ' +
    'do does did doing have has had having i me my mine we us our you your yours he him his she her it its they them their ' +
    'this that these those there here what which who whom whose when where why how can could should would will shall may might must ' +
    'not no yes so than too very just also any all some each such only own same other more most few both up down out off again ' +
    'please tell know get got let lets am s t many much'
  ).split(/\s+/),
);

/** Light suffix stripping so "leaves"/"leave", "arrivals"/"arrival", "approved"/"approve" match. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  return w;
}

export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Content terms: lowercased, stopwords removed, stemmed. */
export function terms(text: string): string[] {
  return words(text)
    .filter((w) => !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)))
    .map(stem);
}

/** 32-bit FNV-1a */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
