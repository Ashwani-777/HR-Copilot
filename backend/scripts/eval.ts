/**
 * `npm run eval` — retrieval quality on the seeded Acme HR policy.
 * For each question we know a phrase that only appears in the right section; a retriever "hits"
 * if that phrase is in one of its top-3 chunks. Compares full-text, vector and hybrid (RRF).
 * Uses whatever EMBEDDING_PROVIDER is configured (re-seed after switching providers).
 */
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';
import { fullTextSearch, hybridSearch, vectorSearch, type RetrievedChunk } from '../src/rag/search.js';

interface EvalCase {
  question: string;
  expect: string; // phrase from the target section
}

const CASES: EvalCase[] = [
  { question: 'How many casual leaves do I get per year?', expect: '12 days of Casual Leave' },
  { question: 'How many sick days are allowed?', expect: '8 days of Sick Leave' },
  { question: "Do I need a doctor's note when I'm ill?", expect: 'medical certificate' },
  { question: 'Can unused earned leave be carried over to next year?', expect: 'Up to 30 days of unused earned leave' },
  { question: 'How many days a week can I work from home?', expect: 'up to 2 days per week' },
  { question: 'Can the sales team work remotely on Mondays?', expect: 'cannot work from home on Mondays' },
  { question: 'What happens if I come in late three times in a month?', expect: 'half a day of casual leave' },
  { question: 'What time does the office day start and end?', expect: '09:30 to 18:30' },
  { question: 'How far from the office can I check in?', expect: 'within 200 metres' },
  { question: 'How much is the meal allowance on client visits?', expect: '₹500 per day' },
  { question: 'What is the mileage rate for using my own car?', expect: '₹12 per kilometre' },
  { question: 'Is there a budget for gym or yoga?', expect: 'Wellness Allowance of up to ₹6,000' },
  { question: 'Is Diwali a company holiday?', expect: 'Diwali (9 November)' },
  { question: 'How many optional holidays can I take?', expect: '2 optional (restricted) holidays' },
  { question: 'Who do I contact about sexual harassment?', expect: 'Internal Committee' },
  { question: 'What should I wear on Fridays?', expect: 'smart casual on Fridays' },
  { question: 'How long is paternity leave?', expect: 'Paternity leave is 5 working days' },
];

const K = 3;
type Method = 'fullText' | 'vector' | 'hybrid';

function rankOf(results: RetrievedChunk[], phrase: string): number | null {
  const i = results.findIndex((r) => r.content.toLowerCase().includes(phrase.toLowerCase()));
  return i === -1 ? null : i + 1;
}

async function main() {
  const company = await prisma.company.findFirst({ where: { name: 'Acme Staffing Pvt Ltd' } });
  if (!company) throw new Error('Acme not found — run `npm run seed` first.');
  const chunkCount = await prisma.chunk.count({ where: { companyId: company.id } });

  const methods: Record<Method, (q: string) => Promise<RetrievedChunk[]>> = {
    fullText: (q) => fullTextSearch(company.id, q, 5),
    vector: (q) => vectorSearch(company.id, q, 5),
    hybrid: (q) => hybridSearch(company.id, q, 5),
  };
  const stats: Record<Method, { hits: number; rr: number }> = { fullText: { hits: 0, rr: 0 }, vector: { hits: 0, rr: 0 }, hybrid: { hits: 0, rr: 0 } };

  console.log(`\nRetrieval eval — ${CASES.length} questions, ${chunkCount} Acme chunks, embeddings: ${config.EMBEDDING_PROVIDER}\n`);
  console.log(`${'question'.padEnd(58)} ${'FTS'.padStart(4)} ${'VEC'.padStart(4)} ${'HYB'.padStart(4)}   (rank of the right chunk, – = not in top 5)`);
  console.log('-'.repeat(80));
  for (const c of CASES) {
    const ranks = {} as Record<Method, number | null>;
    for (const m of Object.keys(methods) as Method[]) {
      const rank = rankOf(await methods[m](c.question), c.expect);
      ranks[m] = rank;
      if (rank !== null && rank <= K) stats[m].hits++;
      if (rank !== null) stats[m].rr += 1 / rank;
    }
    const cell = (r: number | null) => (r === null ? '–' : r <= K ? `${r}` : `(${r})`).padStart(4);
    console.log(`${c.question.slice(0, 57).padEnd(58)} ${cell(ranks.fullText)} ${cell(ranks.vector)} ${cell(ranks.hybrid)}`);
  }
  console.log('-'.repeat(80));
  const pct = (m: Method) => `${((100 * stats[m].hits) / CASES.length).toFixed(0)}%`.padStart(4);
  const mrr = (m: Method) => (stats[m].rr / CASES.length).toFixed(2).padStart(4);
  console.log(`${`hit-rate@${K}`.padEnd(58)} ${pct('fullText')} ${pct('vector')} ${pct('hybrid')}`);
  console.log(`${'MRR@5'.padEnd(58)} ${mrr('fullText')} ${mrr('vector')} ${mrr('hybrid')}\n`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
