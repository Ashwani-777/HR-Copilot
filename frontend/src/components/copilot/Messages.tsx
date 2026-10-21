import { useRef, useState } from 'react';
import { Check, Copy, RotateCcw, Square } from 'lucide-react';
import type { ToolStep, UIMessage } from '../../providers/ChatProvider';
import { Markdown } from './Markdown';
import { Citations, type CitationsHandle } from './Citations';

export function UserBubble({ message }: { message: UIMessage }) {
  return (
    <div className="flex justify-end animate-fade-up">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] bg-ink px-[18px] py-2.5 text-body text-white">
        {message.content}
      </p>
    </div>
  );
}

const stripEllipsis = (s: string) => s.replace(/(\.\.\.|…)\s*$/, '');

function ToolTrail({ tools, live }: { tools: ToolStep[]; live: boolean }) {
  if (tools.length === 0 && !live) return null;
  if (live) {
    const label = tools.at(-1)?.label ?? 'Thinking…';
    return (
      <p className="text-shimmer text-body" role="status" aria-live="polite">
        {label}
      </p>
    );
  }
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Steps taken">
      {tools.map((t, i) => (
        <li key={`${t.name}-${i}`} className="inline-flex items-center gap-1.5 text-caption text-tertiary">
          <Check className="h-3 w-3" />
          {stripEllipsis(t.label)}
        </li>
      ))}
    </ul>
  );
}

export function AssistantMessage({ message, onRetry, canRetry }: { message: UIMessage; onRetry: () => void; canRetry: boolean }) {
  const citationsRef = useRef<CitationsHandle>(null);
  const [copied, setCopied] = useState(false);
  const streaming = message.status === 'streaming';
  const waiting = streaming && message.content === '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <div className="animate-fade-up" aria-busy={streaming || undefined}>
      <ToolTrail tools={message.tools} live={waiting} />

      {message.content && (
        <Markdown
          content={message.content}
          streaming={streaming}
          idPrefix={message.id}
          citations={message.citations}
          onCite={(i) => citationsRef.current?.open(i)}
        />
      )}

      <Citations ref={citationsRef} citations={message.citations} messageId={message.id} />

      {message.status === 'error' && (
        <div className="mt-3 flex flex-wrap items-center gap-3" role="alert">
          <p className="text-small text-red">{message.error ?? 'Something went wrong.'}</p>
          {canRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 text-small font-medium text-ink underline-offset-4 hover:underline"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </button>
          )}
        </div>
      )}

      {message.status === 'stopped' && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-caption text-tertiary">
          <Square className="h-3 w-3" /> Stopped
        </p>
      )}

      {message.status === 'done' && message.content && (
        <div className="mt-3 flex items-center gap-1">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex h-7 items-center gap-1.5 rounded-pill px-2 text-caption text-tertiary transition-colors hover:bg-surface hover:text-ink"
            aria-label={copied ? 'Copied' : 'Copy answer'}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </div>
  );
}
