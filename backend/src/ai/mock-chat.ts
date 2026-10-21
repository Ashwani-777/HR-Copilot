/**
 * Deterministic, offline "LLM" for demos and tests. It implements the same ChatProvider contract as
 * the real models: turn 1 routes the question to a tool by keywords; turn 2 writes a templated answer
 * from the tool results (quoting the best-matching policy sentences with [n] citations), streamed
 * word by word. The agent loop, tools, SSE and citations are exercised exactly as with a real model.
 */
import { config } from '../config.js';
import { addDays, DATE_RE, endOfMonth, formatHuman, startOfMonth, startOfWeek, todayIn } from '../lib/time.js';
import type { AgentMessage, ChatProvider, ToolCall, TurnParams, TurnResult } from './types.js';
import { terms } from './text.js';

const DONT_KNOW = "I don't know — I couldn't find anything about that in your company's HR documents. Please check with HR.";

// ---------------------------------------------------------------------------
// Routing (question → tool call)
// ---------------------------------------------------------------------------

interface Range {
  from: string;
  to: string;
}

export function parseRange(q: string, today: string): Range {
  const explicit = q.match(/\d{4}-\d{2}-\d{2}/g)?.filter((d) => DATE_RE.test(d)) ?? [];
  if (explicit.length >= 2) return { from: explicit[0]! < explicit[1]! ? explicit[0]! : explicit[1]!, to: explicit[0]! < explicit[1]! ? explicit[1]! : explicit[0]! };
  if (explicit.length === 1) return { from: explicit[0]!, to: explicit[0]! };
  if (/\btoday\b/.test(q)) return { from: today, to: today };
  if (/\byesterday\b/.test(q)) return { from: addDays(today, -1), to: addDays(today, -1) };
  if (/\b(last|previous|past) week\b/.test(q)) {
    const monday = addDays(startOfWeek(today), -7);
    return { from: monday, to: addDays(monday, 4) };
  }
  if (/\bthis week\b|\bweek\b/.test(q)) return { from: startOfWeek(today), to: today };
  if (/\b(last|previous|past) month\b/.test(q)) {
    const prev = addDays(startOfMonth(today), -1);
    return { from: startOfMonth(prev), to: endOfMonth(prev) };
  }
  if (/\bthis month\b|\bmonth\b/.test(q)) return { from: startOfMonth(today), to: today };
  const lastN = /\b(?:last|past) (\d{1,3}) days\b/.exec(q);
  if (lastN) return { from: addDays(today, -(Number(lastN[1]) - 1)), to: today };
  return { from: addDays(today, -29), to: today };
}

function parseDay(q: string, today: string): string {
  const explicit = /\d{4}-\d{2}-\d{2}/.exec(q)?.[0];
  if (explicit) return explicit;
  if (/\btomorrow\b/.test(q)) return addDays(today, 1);
  if (/\byesterday\b/.test(q)) return addDays(today, -1);
  return today;
}

const NOT_NAMES = new Set(
  'Casual Sick Earned Leave Leaves Balance Acme Globex Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Hr Me Him Her Them Us'.split(' '),
);

export function extractName(original: string): string | undefined {
  const patterns = [
    /\bfor ([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/,
    /\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)'s\b/,
    /\b(?:does|did|has|is) ([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:have|got|take|taken|left|been|on)\b/,
    /\bof ([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/,
  ];
  for (const p of patterns) {
    const name = p.exec(original)?.[1];
    if (name && !name.split(' ').some((w) => NOT_NAMES.has(w))) return name;
  }
  return undefined;
}

function extractDepartment(q: string): string | undefined {
  const m = /\b(?:in|for|from) (?:the )?([a-z&]+(?: [a-z]+)?) (?:team|department|dept)\b/.exec(q);
  return m?.[1];
}

function extractMinCount(q: string): number | undefined {
  const m = /(?:more than|over) (\d+)/.exec(q);
  if (m) return Number(m[1]) + 1;
  const n = /(?:at least |)(\d+)\+? (?:or more )?times/.exec(q);
  if (n) return Number(n[1]);
  if (/\b(repeat|repeated|repeatedly|habitual|habitually|often|frequent|frequently|regularly|serial)\b/.test(q)) return 3;
  return undefined;
}

const POLICY_WORDS =
  /\b(policy|policies|rule|rules|allowed|allowance|entitle\w*|eligib\w*|can i|may i|how do i|how to|process|procedure|penalt\w*|deduct\w*|happens?|grace|carr(y|ied) forward|encash\w*|apply|certificate|notice|warning)\b/;

type PlannedCall = Omit<ToolCall, 'id'>;

export function planToolCalls(original: string, today: string): PlannedCall[] {
  const q = original.toLowerCase();
  const policyish = POLICY_WORDS.test(q);

  if (/\b(who|anyone|anybody|which (people|employees))\b.*\b(on leave|off|absent|away|out of office|ooo)\b|\bon leave (today|tomorrow|yesterday|on)\b/.test(q) && !policyish) {
    return [{ name: 'getWhoIsOnLeave', args: { date: parseDay(q, today) } }];
  }
  if (/\blate\b|\blatecomers?\b|\blate-comers?\b|\btardy\b|\bpunctual\w*\b/.test(q) && !policyish) {
    const minCount = extractMinCount(q);
    return [{ name: 'getLateArrivals', args: { ...parseRange(q, today), ...(minCount ? { minCount } : {}) } }];
  }
  if (/\b(balance|remaining|left|used|taken)\b|\bhow many\b.*\b(do i have|have i|does \w+ have|i have)\b/.test(q) && /\b(leaves?|cl|sl|el|days? off)\b/.test(q) && !/\bget\b.*\bper\b/.test(q)) {
    const employeeName = extractName(original);
    return [{ name: 'getLeaveBalance', args: employeeName ? { employeeName } : {} }];
  }
  if (/\b(attendance|present|absent|absence|absences|absentee\w*|check-?ins?|showed up|came in)\b/.test(q) && !policyish) {
    const department = extractDepartment(q);
    const employeeName = extractName(original);
    return [{ name: 'getAttendanceSummary', args: { ...parseRange(q, today), ...(department ? { department } : {}), ...(employeeName ? { employeeName } : {}) } }];
  }
  return [{ name: 'searchPolicy', args: { query: original } }];
}

// ---------------------------------------------------------------------------
// Answer templates (tool results → markdown text)
// ---------------------------------------------------------------------------

const shortDate = (d: string) => formatHuman(d).replace(/ \d{4}$/, '');
const rangeLabel = (from: string, to: string) => (from === to ? `on ${formatHuman(from)}` : `between ${shortDate(from)} and ${formatHuman(to)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const leaveName = (t: string) => ({ CASUAL: 'casual', SICK: 'sick', EARNED: 'earned' })[t] ?? t.toLowerCase();

function splitSentences(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line)) // headings
    .map((line) => line.replace(/^\s*[-*•]\s+/, '').replace(/\*\*/g, '').trim())
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z₹0-9"(])/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);
}

interface PolicyResult {
  citation: number;
  documentTitle: string;
  page: number | null;
  text: string;
}

function answerPolicy(question: string, data: { results?: PolicyResult[] }): string {
  const results = data.results ?? [];
  if (results.length === 0) return DONT_KNOW;
  const qTerms = new Set(terms(question));
  const wantsNumber = /\bhow (many|much|long|soon|far)\b|\bwhen\b|\blimit\b|\bmax(imum)?\b/i.test(question);

  const scored: { citation: number; sentence: string; score: number; order: number }[] = [];
  results.slice(0, 3).forEach((r, ri) => {
    splitSentences(r.text).forEach((sentence, si) => {
      const overlap = new Set(terms(sentence).filter((t) => qTerms.has(t))).size;
      if (overlap === 0) return;
      const score = overlap + (wantsNumber && /\d/.test(sentence) ? 0.5 : 0);
      scored.push({ citation: r.citation, sentence, score, order: ri * 1000 + si });
    });
  });
  if (scored.length === 0) return DONT_KNOW;

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const top = scored[0]!.score;
  const picked: typeof scored = [];
  const perCitation = new Map<number, number>();
  for (const s of scored) {
    if (picked.length >= 3 || s.score < Math.max(1, top / 2)) break;
    if (picked.some((p) => p.sentence === s.sentence)) continue; // same sentence in overlapping chunks
    if ((perCitation.get(s.citation) ?? 0) >= 2) continue;
    perCitation.set(s.citation, (perCitation.get(s.citation) ?? 0) + 1);
    picked.push(s);
  }
  const title = results[0]!.documentTitle;
  return [`Here's what the **${title}** says:`, '', ...picked.map((p) => `- ${p.sentence} [${p.citation}]`)].join('\n');
}

interface LateData {
  from: string;
  to: string;
  shiftStart: string;
  totalLateArrivals: number;
  scope?: string;
  employees: { name: string; department: string; lateCount: number; arrivals: { date: string; checkIn: string }[] }[];
}
function answerLate(d: LateData): string {
  const range = rangeLabel(d.from, d.to);
  if (d.employees.length === 0) return d.scope === 'self' ? `You haven't checked in late ${range}. 🎉` : `Nobody checked in late ${range}.`;
  const lines = d.employees.map(
    (e) => `- **${e.name}** (${e.department}) — ${plural(e.lateCount, 'time')}: ${e.arrivals.map((a) => `${shortDate(a.date)} at ${a.checkIn}`).join(', ')}`,
  );
  const who = d.scope === 'self' ? 'You checked in late' : `**${plural(d.totalLateArrivals, 'late check-in')}** by ${plural(d.employees.length, 'person', 'people')}`;
  return [`${who} ${range} (shift starts at ${d.shiftStart}):`, '', ...lines].join('\n');
}

interface SummaryData {
  from: string;
  to: string;
  workingDays: number;
  totals: { present: number; onTime: number; late: number; onLeave: number; absent: number; onTimeRatePct: number | null };
  employees: { name: string; department: string; present: number; late: number; onLeave: number; absent: number; averageCheckIn: string | null }[];
  note?: string;
}
function answerSummary(d: SummaryData): string {
  if (!d.employees?.length) return 'No employees matched that filter, so there is no attendance to summarise.';
  const head = `Attendance ${rangeLabel(d.from, d.to)} (${plural(d.workingDays, 'working day')}):`;
  const totals = [
    `- **${plural(d.totals.present, 'check-in')}**, ${d.totals.onTimeRatePct ?? 0}% on time (${d.totals.late} late)`,
    `- ${plural(d.totals.onLeave, 'day')} on approved leave · ${plural(d.totals.absent, 'unplanned absence')}`,
  ];
  const rows =
    d.employees.length === 1
      ? [`- Average check-in time: ${d.employees[0]!.averageCheckIn ?? '—'}`]
      : ['', 'By employee (most late first):', ...d.employees.slice(0, 8).map((e) => `- **${e.name}** — present ${e.present}, late ${e.late}, leave ${e.onLeave}, absent ${e.absent}`)];
  return [head, '', ...totals, ...rows, ...(d.note ? ['', d.note] : [])].join('\n');
}

interface BalanceData {
  ambiguous?: boolean;
  matches?: string[];
  employee?: string;
  year?: number;
  balances?: { type: string; allowed: number; used: number; remaining: number }[];
  pendingRequests?: { type: string; from: string; to: string; days: number }[];
  note?: string;
}
function answerBalance(d: BalanceData): string {
  if (d.ambiguous) return `I found several matching employees: ${d.matches?.join(', ')}. Which one did you mean?`;
  const lines = (d.balances ?? []).map((b) => `- ${leaveName(b.type)[0]!.toUpperCase()}${leaveName(b.type).slice(1)}: **${b.remaining}** of ${b.allowed} days left (${b.used} used)`);
  const pending = (d.pendingRequests ?? []).map((p) => `${plural(p.days, 'day')} of ${leaveName(p.type)} leave (${shortDate(p.from)}${p.from === p.to ? '' : ` – ${shortDate(p.to)}`})`);
  return [
    `Leave balance for **${d.employee}** in ${d.year}:`,
    '',
    ...lines,
    ...(pending.length ? ['', `Pending approval: ${pending.join('; ')}.`] : []),
    ...(d.note ? ['', d.note] : []),
  ].join('\n');
}

interface OnLeaveData {
  date: string;
  isWeekend: boolean;
  scope?: string;
  onLeave: { name: string; department: string; type: string; from: string; to: string }[];
}
function answerOnLeave(d: OnLeaveData): string {
  const day = formatHuman(d.date);
  const weekend = d.isWeekend ? ` (${day} is a weekend)` : '';
  if (d.onLeave.length === 0) return d.scope === 'self' ? `You're not on approved leave on ${day}${weekend}.` : `Nobody is on approved leave on ${day}${weekend}.`;
  const lines = d.onLeave.map((l) => `- **${l.name}** (${l.department}) — ${leaveName(l.type)} leave, ${shortDate(l.from)}${l.from === l.to ? '' : ` – ${shortDate(l.to)}`}`);
  return [`${d.scope === 'self' ? "You're" : plural(d.onLeave.length, 'person', 'people') + (d.onLeave.length === 1 ? ' is' : ' are')} on leave on ${day}${weekend}:`, '', ...lines].join('\n');
}

export function composeAnswer(question: string, toolMessages: Extract<AgentMessage, { role: 'tool' }>[]): string {
  const sections = toolMessages.map((m) => {
    let data: unknown;
    try {
      data = JSON.parse(m.content);
    } catch {
      return "Sorry — I couldn't read that result.";
    }
    if (m.isError) return `I couldn't get that: ${(data as { error?: string }).error ?? 'unknown error'}`;
    switch (m.name) {
      case 'searchPolicy':
        return answerPolicy(question, data as { results?: PolicyResult[] });
      case 'getLateArrivals':
        return answerLate(data as LateData);
      case 'getAttendanceSummary':
        return answerSummary(data as SummaryData);
      case 'getLeaveBalance':
        return answerBalance(data as BalanceData);
      case 'getWhoIsOnLeave':
        return answerOnLeave(data as OnLeaveData);
      default:
        return '';
    }
  });
  return sections.filter(Boolean).join('\n\n') || DONT_KNOW;
}

// ---------------------------------------------------------------------------

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal?.aborted) return resolve();
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export class MockChatProvider implements ChatProvider {
  readonly name = 'mock';
  readonly mayEmitPreamble = false;
  private seq = 0;

  constructor(private readonly delayMs = config.MOCK_STREAM_DELAY_MS) {}

  async turn({ system, messages, toolChoice, onText, signal }: TurnParams): Promise<TurnResult> {
    let lastUser = -1;
    messages.forEach((m, i) => {
      if (m.role === 'user') lastUser = i;
    });
    const question = lastUser >= 0 ? (messages[lastUser] as { content: string }).content : '';
    const toolResults = messages.slice(lastUser + 1).filter((m): m is Extract<AgentMessage, { role: 'tool' }> => m.role === 'tool');
    // Read "today" from the system prompt, exactly like a real model would.
    const today = /Today's date: (\d{4}-\d{2}-\d{2})/.exec(system)?.[1] ?? todayIn('Asia/Kolkata');

    if (toolResults.length === 0 && toolChoice === 'auto') {
      const toolCalls = planToolCalls(question, today).map((c) => ({ ...c, id: `mock_call_${++this.seq}` }));
      return { text: '', toolCalls };
    }

    const text = toolResults.length ? composeAnswer(question, toolResults) : DONT_KNOW;
    for (const token of text.match(/\s*\S+\s*/g) ?? [text]) {
      if (signal?.aborted) break;
      onText(token);
      await sleep(this.delayMs, signal);
    }
    return { text, toolCalls: [] };
  }
}
