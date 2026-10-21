import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { Citation } from '../../types';
import { citePillId } from '../../lib/markdown';

export type CitationsHandle = { open: (index: number) => void };

const citationLabel = (c: Citation) => `${c.documentTitle}${c.page != null ? ` · p.${c.page}` : ''}`;

/** Grey source pills under an answer; clicking one (or a [n] marker) opens a popover with the snippet. */
export const Citations = forwardRef<CitationsHandle, { citations: Citation[]; messageId: string }>(function Citations(
  { citations, messageId },
  ref,
) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef(new Map<number, HTMLButtonElement>());

  useImperativeHandle(ref, () => ({
    open(index: number) {
      if (!citations.some((c) => c.index === index)) return;
      setOpenIndex(index);
      rootRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  }));

  useEffect(() => {
    if (openIndex === null) return;
    popoverRef.current?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!rootRef.current?.contains(target) && !target.closest('[data-cite-marker]')) setOpenIndex(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const pill = pillRefs.current.get(openIndex);
        setOpenIndex(null);
        pill?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openIndex]);

  if (citations.length === 0) return null;
  const open = citations.find((c) => c.index === openIndex) ?? null;
  const popoverId = `${messageId}-source`;

  return (
    <div ref={rootRef} className="relative mt-4">
      <ul className="flex flex-wrap gap-2" aria-label="Sources">
        {citations.map((c) => {
          const active = c.index === openIndex;
          return (
            <li key={c.index}>
              <button
                ref={(el) => {
                  if (el) pillRefs.current.set(c.index, el);
                  else pillRefs.current.delete(c.index);
                }}
                id={citePillId(messageId, c.index)}
                type="button"
                onClick={() => setOpenIndex(active ? null : c.index)}
                aria-expanded={active}
                aria-controls={active ? popoverId : undefined}
                className={cn(
                  'inline-flex h-7 max-w-[280px] items-center gap-1.5 rounded-pill px-3 text-caption font-medium transition-colors duration-200',
                  active ? 'bg-ink text-white' : 'bg-surface text-secondary hover:bg-hairline/60 hover:text-ink',
                )}
              >
                <span className="tabular-nums">[{c.index}]</span>
                <span className="truncate">{citationLabel(c)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <div
          id={popoverId}
          ref={popoverRef}
          tabIndex={-1}
          role="dialog"
          aria-label={`Source ${open.index}: ${open.documentTitle}`}
          className="absolute left-0 top-full z-20 mt-2 w-full max-w-[480px] animate-fade-up rounded-card border border-hairline/70 bg-white p-5 shadow-soft focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-input bg-surface">
                <FileText className="h-[18px] w-[18px] text-secondary" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-body font-semibold">{open.documentTitle}</p>
                <p className="text-caption text-tertiary">
                  Source {open.index}
                  {open.page != null && ` · Page ${open.page}`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpenIndex(null)}
              aria-label="Close source"
              className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary hover:bg-surface hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <blockquote className="mt-4 max-h-60 overflow-y-auto whitespace-pre-wrap border-l-2 border-hairline pl-4 text-small leading-[1.5] text-secondary">
            {open.snippet}
          </blockquote>
        </div>
      )}
    </div>
  );
});
