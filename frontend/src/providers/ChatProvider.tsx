import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { readSSE, toChatEvent } from '../lib/sse';
import type { ChatMessage, Citation } from '../types';

export type ToolStep = { name: string; label: string };

export type UIMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tools: ToolStep[];
  citations: Citation[];
  status: 'streaming' | 'done' | 'stopped' | 'error';
  error?: string;
};

type ChatContextValue = {
  messages: UIMessage[];
  streaming: boolean;
  send: (text: string) => void;
  stop: () => void;
  retry: () => void;
  reset: () => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);
const HISTORY_LIMIT = 10;
let seq = 0;
const newId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Conversation state lives above the routes so navigating away and back keeps the chat. */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const messagesRef = useRef<UIMessage[]>([]);
  messagesRef.current = messages;
  const abortRef = useRef<AbortController | null>(null);
  const streaming = messages.some((m) => m.status === 'streaming');

  // Abort an in-flight answer when the provider really unmounts (sign-out). The deferred check matters:
  // React StrictMode runs mount → unmount → mount in dev, and aborting synchronously there killed the
  // very first request (seen with /copilot?q=… deep links).
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setTimeout(() => {
        if (!alive.current) abortRef.current?.abort();
      }, 0);
    };
  }, []);

  const patch = useCallback((id: string, fn: (m: UIMessage) => UIMessage) => {
    setMessages((all) => all.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const run = useCallback(
    async (text: string, prior: UIMessage[]) => {
      const history: ChatMessage[] = prior
        .filter((m) => m.content.trim() !== '' && m.status !== 'error')
        .map((m) => ({ role: m.role, content: m.content }))
        .slice(-HISTORY_LIMIT);

      const userMsg: UIMessage = { id: newId(), role: 'user', content: text, tools: [], citations: [], status: 'done' };
      const botId = newId();
      const botMsg: UIMessage = { id: botId, role: 'assistant', content: '', tools: [], citations: [], status: 'streaming' };
      setMessages([...prior, userMsg, botMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      // Tokens arrive fast; coalesce them into one render per animation frame.
      let pending = '';
      let frame = 0;
      const flush = () => {
        frame = 0;
        if (!pending) return;
        const chunk = pending;
        pending = '';
        patch(botId, (m) => ({ ...m, content: m.content + chunk }));
      };

      let finalStatus: UIMessage['status'] | null = null;
      let finalError: string | undefined;
      let gotTokens = false;

      try {
        const res = await api.chat({ message: text, history }, controller.signal);
        if (!res.body) throw new ApiError(0, 'INTERNAL', 'The server returned an empty response.');
        for await (const raw of readSSE(res.body)) {
          const ev = toChatEvent(raw);
          if (!ev) continue;
          if (ev.type === 'tool') {
            patch(botId, (m) => ({ ...m, tools: [...m.tools, { name: ev.name, label: ev.label }] }));
          } else if (ev.type === 'token') {
            gotTokens = true;
            pending += ev.text;
            if (!frame) frame = requestAnimationFrame(flush);
          } else if (ev.type === 'citations') {
            const unique = new Map<number, Citation>();
            for (const c of ev.citations) if (!unique.has(c.index)) unique.set(c.index, c);
            patch(botId, (m) => ({ ...m, citations: [...unique.values()].sort((a, b) => a.index - b.index) }));
          } else if (ev.type === 'done') {
            finalStatus = 'done';
            break;
          } else if (ev.type === 'error') {
            finalStatus = 'error';
            finalError = ev.message;
            break;
          }
        }
        if (!finalStatus) {
          finalStatus = gotTokens ? 'done' : 'error';
          if (!gotTokens) finalError = 'The answer stopped unexpectedly. Please try again.';
        }
      } catch (e) {
        if (controller.signal.aborted || (e instanceof ApiError && e.code === 'ABORTED')) {
          finalStatus = 'stopped';
        } else {
          finalStatus = 'error';
          finalError = errorMessage(e);
        }
      } finally {
        if (frame) cancelAnimationFrame(frame);
        flush();
        if (abortRef.current === controller) abortRef.current = null;
        const status = finalStatus ?? 'done';
        patch(botId, (m) => ({ ...m, status, error: finalError }));
      }
    },
    [patch],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || messagesRef.current.some((m) => m.status === 'streaming')) return;
      void run(text, messagesRef.current);
    },
    [run],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /** Re-ask the last question after a failure (drops the failed turn first). */
  const retry = useCallback(() => {
    const all = messagesRef.current;
    if (all.some((m) => m.status === 'streaming')) return;
    let lastUser = -1;
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i]!.role === 'user') {
        lastUser = i;
        break;
      }
    }
    if (lastUser === -1) return;
    void run(all[lastUser]!.content, all.slice(0, lastUser));
  }, [run]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
  }, []);

  const value = useMemo(
    () => ({ messages, streaming, send, stop, retry, reset }),
    [messages, streaming, send, stop, retry, reset],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
