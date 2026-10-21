import { Fragment, memo, type ReactNode } from 'react';
import { citePillId, parseBlocks, parseInline, tidyStreaming, type Inline } from '../../lib/markdown';
import type { Citation } from '../../types';

type CiteHandler = (index: number) => void;
type Ctx = { cites: Map<number, Citation>; onCite: CiteHandler; idPrefix: string };

/**
 * Superscript link to the matching source pill. It is an inline <a> (not an inline-block button)
 * so the browser never wraps the line between the word and its marker ("year¹" stays together).
 */
function CiteMarker({ index, ctx }: { index: number; ctx: Ctx }) {
  const citation = ctx.cites.get(index);
  const label = citation
    ? `Source ${index}: ${citation.documentTitle}${citation.page != null ? `, page ${citation.page}` : ''}`
    : `Source ${index}`;
  return (
    <sup className="leading-none">
      <a
        href={`#${citePillId(ctx.idPrefix, index)}`}
        data-cite-marker=""
        onClick={(e) => {
          e.preventDefault();
          if (citation) ctx.onCite(index);
        }}
        aria-label={label}
        title={label}
        aria-disabled={!citation || undefined}
        className="ml-[2px] rounded-full bg-surface px-[5px] py-[1px] text-[10px] font-semibold text-secondary no-underline transition-colors duration-150 hover:bg-ink hover:text-white aria-disabled:cursor-default aria-disabled:hover:bg-surface aria-disabled:hover:text-secondary"
      >
        {index}
      </a>
    </sup>
  );
}

function renderInline(nodes: Inline[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={i}>{n.text}</Fragment>;
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            {renderInline(n.children, ctx)}
          </strong>
        );
      case 'em':
        return <em key={i}>{renderInline(n.children, ctx)}</em>;
      case 'code':
        return (
          <code key={i} className="rounded-[6px] bg-surface px-1.5 py-0.5 font-mono text-[0.88em]">
            {n.text}
          </code>
        );
      case 'link':
        return (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-black">
            {renderInline(n.children, ctx)}
          </a>
        );
      case 'cite':
        return (
          <Fragment key={i}>
            {n.indices.map((idx) => (
              <CiteMarker key={idx} index={idx} ctx={ctx} />
            ))}
          </Fragment>
        );
    }
  });
}

/** Renders the copilot's light Markdown safely (no innerHTML) with clickable [n] citation markers. */
export const Markdown = memo(function Markdown({
  content,
  citations,
  onCite,
  streaming = false,
  idPrefix,
}: {
  content: string;
  citations: Citation[];
  onCite: CiteHandler;
  streaming?: boolean;
  /** Message id; links [n] markers to the source pills' element ids. */
  idPrefix: string;
}) {
  const ctx: Ctx = { cites: new Map(citations.map((c) => [c.index, c])), onCite, idPrefix };
  const inline = (s: string) => renderInline(parseInline(s), ctx);

  return (
    <div className="text-body text-ink [&>*+*]:mt-3">
      {parseBlocks(streaming ? tidyStreaming(content) : content).map((b, i) => {
        switch (b.type) {
          case 'p':
            return (
              <p key={i}>
                {b.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(line)}
                  </Fragment>
                ))}
              </p>
            );
          case 'h':
            return (
              <p key={i} className="pt-1 text-[19px] font-semibold tracking-[-0.012em]">
                {inline(b.text)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-tertiary">
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1">
                    {inline(it)}
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} start={b.start} className="list-decimal space-y-1.5 pl-5 marker:text-tertiary">
                {b.items.map((it, j) => (
                  <li key={j} className="pl-1">
                    {inline(it)}
                  </li>
                ))}
              </ol>
            );
          case 'code':
            return (
              <pre key={i} className="overflow-x-auto rounded-input bg-surface p-4 font-mono text-small">
                <code>{b.text}</code>
              </pre>
            );
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-input border border-hairline">
                <table className="w-full border-collapse text-left text-small">
                  <thead className="bg-surface/70">
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={j} scope="col" className="px-3 py-2 font-semibold">
                          {inline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r} className="border-t border-hairline/70">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-2 tabular-nums">
                            {inline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
});
