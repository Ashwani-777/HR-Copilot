import { useEffect, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChat } from '../providers/ChatProvider';
import { Composer, type ComposerHandle } from '../components/copilot/Composer';
import { AssistantMessage, UserBubble } from '../components/copilot/Messages';

const SUGGESTIONS = [
  'How many casual leaves do I get?',
  'Who was late this week?',
  'What’s the work-from-home policy?',
  'Who is on leave today?',
];

export function CopilotPage() {
  const { messages, streaming, send, stop, retry, reset } = useChat();
  const composerRef = useRef<ComposerHandle>(null);
  const stickToBottom = useRef(true);
  const [params, setParams] = useSearchParams();
  const autoSent = useRef(false);

  // Deep link from the dashboard: /copilot?q=… sends once, then cleans the URL.
  useEffect(() => {
    const q = params.get('q');
    if (!q || autoSent.current) return;
    autoSent.current = true;
    setParams({}, { replace: true });
    if (!streaming) {
      stickToBottom.current = true;
      send(q);
    }
  }, [params, setParams, send, streaming]);

  useEffect(() => composerRef.current?.focus(), []);

  // Follow the stream only while the reader is at the bottom; scrolling up pauses it.
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      stickToBottom.current = window.innerHeight + window.scrollY >= el.scrollHeight - 140;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    if (stickToBottom.current && messages.length > 0) {
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [messages]);

  const onSend = (text: string) => {
    stickToBottom.current = true;
    send(text);
  };

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;

  return (
    <div className="mx-auto w-full max-w-chat px-4 pb-44 pt-10 sm:pt-14">
      {messages.length === 0 ? (
        <div className="flex min-h-[calc(100dvh-var(--nav-height)-15rem)] flex-col items-center justify-center text-center animate-fade-up">
          <h1 className="page-title">Ask anything about HR.</h1>
          <p className="mt-3 max-w-md text-[19px] leading-[1.42] tracking-[-0.012em] text-secondary">
            Policies, leave balances and attendance — answered with sources.
          </p>
          <ul className="mt-10 grid w-full gap-2 sm:grid-cols-2" aria-label="Suggestions">
            {SUGGESTIONS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => onSend(s)}
                  className="flex h-full w-full items-center rounded-card bg-surface px-5 py-4 text-left text-body transition-colors duration-200 hover:bg-hairline/50"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <h1 className="sr-only">Copilot conversation</h1>
          <ol className="flex flex-col gap-8" aria-label="Conversation">
            {messages.map((m) => (
              <li key={m.id}>
                {m.role === 'user' ? (
                  <UserBubble message={m} />
                ) : (
                  <AssistantMessage message={m} onRetry={retry} canRetry={m.id === lastAssistantId && !streaming} />
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      <Composer
        ref={composerRef}
        streaming={streaming}
        onSend={onSend}
        onStop={stop}
        onNewChat={
          messages.length > 0
            ? () => {
                reset();
                composerRef.current?.focus();
              }
            : undefined
        }
      />
    </div>
  );
}
