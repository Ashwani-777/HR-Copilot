/**
 * Provider-neutral types. The chat agent (modules/chat/agent.ts) only talks to these interfaces,
 * so mock / OpenAI-compatible / Anthropic are interchangeable via LLM_PROVIDER.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (object) for the tool's arguments */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Already-parsed arguments (validated against the tool's Zod schema before running) */
  args: unknown;
}

export type AgentMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCall[];
      /**
       * Provider-native assistant content, replayed verbatim on the next round
       * (e.g. Anthropic content blocks incl. thinking blocks, which must be passed back unchanged).
       */
      providerData?: unknown;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface TurnParams {
  system: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  /** 'none' on the final round forces a text answer (tools stay declared so history remains valid). */
  toolChoice: 'auto' | 'none';
  /** Called with text deltas as they are generated. */
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  providerData?: unknown;
  /** Set when the provider stopped for a reason the user should see (refusal, truncation). */
  stopNote?: string;
}

export interface ChatProvider {
  readonly name: string;
  /**
   * True if the model may write text *before* deciding to call tools in the same turn (real LLMs).
   * The agent then holds text back briefly so a preamble never precedes `tool` SSE events.
   */
  readonly mayEmitPreamble: boolean;
  turn(params: TurnParams): Promise<TurnResult>;
}

export interface EmbeddingProvider {
  /** Stable id stored on Document.embeddingModel; vector search only compares chunks with the same id. */
  readonly id: string;
  readonly dimensions: number;
  /** Cosine similarity below which a vector hit is treated as irrelevant. */
  readonly minSimilarity: number;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_DIMENSIONS = 1536;
