import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Plus, Square } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ComposerHandle = { focus: () => void };

/** Pinned input bar: Enter sends, Shift+Enter adds a newline, stop button while streaming. */
export const Composer = forwardRef<
  ComposerHandle,
  { streaming: boolean; onSend: (text: string) => void; onStop: () => void; onNewChat?: () => void }
>(function Composer({ streaming, onSend, onStop, onNewChat }, ref) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }));

  // Auto-grow up to ~6 lines.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !streaming;

  function submit() {
    if (!canSend) return;
    onSend(value);
    setValue('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="nav-blur fixed inset-x-0 bottom-0 z-30 border-t border-hairline/50 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
      <form
        className="mx-auto flex max-w-chat items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {onNewChat && (
          <button
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
            title="New chat"
            className="mb-[5px] flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-ink transition-colors duration-200 hover:bg-hairline/60"
          >
            <Plus className="h-[18px] w-[18px]" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 items-end rounded-[26px] border border-hairline bg-white pl-[18px] pr-1.5 shadow-soft transition-[border-color,box-shadow] duration-200 focus-within:border-ink focus-within:ring-1 focus-within:ring-ink">
          <label htmlFor="copilot-input" className="sr-only">
            Message Copilot
          </label>
          <textarea
            id="copilot-input"
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask anything about HR…"
            className="max-h-[168px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-3 text-body text-ink placeholder:text-tertiary focus:outline-none focus-visible:outline-none"
            autoComplete="off"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop"
              className="mb-1.5 ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-colors duration-200 hover:bg-black"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send"
              title="Send (Enter)"
              className={cn(
                'mb-1.5 ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[background-color,opacity] duration-200',
                canSend ? 'bg-ink text-white hover:bg-black' : 'bg-surface text-tertiary',
              )}
            >
              <ArrowUp className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </form>
      <p className="mx-auto mt-2 max-w-chat text-center text-caption text-tertiary">
        Answers come from your company’s documents and HR data. Check important details.
      </p>
    </div>
  );
});
