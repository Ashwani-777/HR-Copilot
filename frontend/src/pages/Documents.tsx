import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, FileUp, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { qk } from '../lib/queryClient';
import { cn } from '../lib/cn';
import { formatDateTime, plural } from '../lib/format';
import { useSession } from '../providers/AuthProvider';
import { useSocket } from '../providers/SocketProvider';
import { Page } from '../components/layout/Page';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  ProgressBar,
  SkeletonRows,
  StatusDot,
  useToast,
} from '../components/ui';
import type { Doc, DocumentsResponse } from '../types';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = ['.pdf', '.txt', '.md'];
const ACCEPT = '.pdf,.txt,.md,application/pdf,text/plain,text/markdown';

type Upload = { key: string; name: string; progress: number; error?: string };

const inFlight = (d: Doc) => d.status === 'QUEUED' || d.status === 'PROCESSING';

function upsert(list: Doc[], doc: Doc, mode: 'replace' | 'insert-only'): Doc[] {
  const i = list.findIndex((d) => d.id === doc.id);
  if (i === -1) return [doc, ...list];
  if (mode === 'insert-only') return list;
  const next = list.slice();
  next[i] = doc;
  return next;
}

export function DocumentsPage() {
  const { isAdmin, company } = useSession();
  const { socket, connected } = useSocket();
  const queryClient = useQueryClient();
  const deletedIds = useRef(new Set<string>());

  const documents = useQuery({
    queryKey: qk.documents,
    queryFn: api.documents,
    // Fallback if the socket is down: poll while something is still processing.
    refetchInterval: (q) =>
      !connected && (q.state.data as DocumentsResponse | undefined)?.documents.some(inFlight) ? 3000 : false,
  });

  // Live status/progress via Socket.IO `document:status` (payload: Doc).
  useEffect(() => {
    if (!socket) return;
    const onStatus = (doc: Doc) => {
      if (!doc?.id || deletedIds.current.has(doc.id)) return;
      queryClient.setQueryData<DocumentsResponse>(qk.documents, (d) =>
        d ? { documents: upsert(d.documents, doc, 'replace') } : d,
      );
    };
    socket.on('document:status', onStatus);
    return () => {
      socket.off('document:status', onStatus);
    };
  }, [socket, queryClient]);

  // Re-sync when the socket (re)connects, in case we missed events while offline.
  useEffect(() => {
    if (connected) void queryClient.invalidateQueries({ queryKey: qk.documents });
  }, [connected, queryClient]);

  const docs = documents.data?.documents ?? [];

  return (
    <Page
      title="Documents"
      subtitle={
        isAdmin
          ? 'Policies Copilot can read and cite. Upload a PDF, text or Markdown file.'
          : `Policies from ${company.name} that Copilot reads and cites.`
      }
      actions={
        <span className="inline-flex items-center gap-2 text-small text-secondary" aria-live="polite">
          <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-green' : 'bg-tertiary')} aria-hidden="true" />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      }
    >
      {isAdmin && (
        <Uploader
          onUploaded={(doc) =>
            queryClient.setQueryData<DocumentsResponse>(qk.documents, (d) =>
              d ? { documents: upsert(d.documents, doc, 'insert-only') } : { documents: [doc] },
            )
          }
        />
      )}

      <section aria-label="Document list" className={isAdmin ? 'mt-10' : undefined}>
        {documents.isPending ? (
          <SkeletonRows rows={4} />
        ) : documents.isError ? (
          <Card>
            <ErrorState error={documents.error} onRetry={() => void documents.refetch()} />
          </Card>
        ) : docs.length === 0 ? (
          <Card>
            <EmptyState icon={<FileText />} title="No documents yet.">
              {isAdmin
                ? 'Upload your HR policy and Copilot will start answering from it, with citations.'
                : 'Your HR team hasn’t uploaded any policies yet.'}
            </EmptyState>
          </Card>
        ) : (
          <Card as="ul" padding="none" variant="outline" className="divide-y divide-hairline/70 overflow-hidden">
            {docs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onDeleted={(id) => {
                  deletedIds.current.add(id);
                  queryClient.setQueryData<DocumentsResponse>(qk.documents, (d) =>
                    d ? { documents: d.documents.filter((x) => x.id !== id) } : d,
                  );
                }}
              />
            ))}
          </Card>
        )}
      </section>
    </Page>
  );
}

// ---- Upload ---------------------------------------------------------------------------------

function Uploader({ onUploaded }: { onUploaded: (doc: Doc) => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const dragDepth = useRef(0);

  const update = (key: string, patch: Partial<Upload>) =>
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function validate(file: File): string | null {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return 'Only .pdf, .txt and .md files are supported.';
    if (file.size > MAX_BYTES) return 'That file is larger than 10 MB.';
    if (file.size === 0) return 'That file is empty.';
    return null;
  }

  function start(files: File[]) {
    if (files.length === 0) return;
    const useTitle = files.length === 1 ? title : '';
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const problem = validate(file);
      setUploads((u) => [...u, { key, name: file.name, progress: 0, error: problem ?? undefined }]);
      if (problem) continue;
      api
        .uploadDocument(file, useTitle, (f) => update(key, { progress: f * 100 }))
        .then((doc) => {
          setUploads((u) => u.filter((x) => x.key !== key));
          onUploaded(doc);
          toast.success(`“${doc.title}” uploaded — indexing now.`);
        })
        .catch((e: unknown) => update(key, { error: errorMessage(e) }));
    }
    setTitle('');
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    start(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="grid gap-4">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center rounded-card border-2 border-dashed px-6 py-12 text-center transition-colors duration-200',
          dragging ? 'border-ink bg-surface' : 'border-hairline bg-white',
        )}
      >
        <FileUp className={cn('h-8 w-8 transition-transform duration-200', dragging ? '-translate-y-1 text-ink' : 'text-tertiary')} />
        <p className="mt-4 text-card">{dragging ? 'Drop to upload' : 'Drag files here'}</p>
        <p className="mt-1 text-small text-secondary">PDF, TXT or Markdown · up to 10 MB</p>
        <Button variant="secondary" className="mt-6" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose documents to upload"
          onChange={(e) => {
            start(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      <Field label="Title (optional)" hint="Used for the next single-file upload. Defaults to the file name." className="max-w-md">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme HR Policy 2026" maxLength={120} />
      </Field>

      {uploads.length > 0 && (
        <ul className="grid gap-2" aria-label="Uploads">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-4 rounded-input bg-surface px-4 py-3 animate-fade-up">
              <FileText className="h-5 w-5 shrink-0 text-secondary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-small font-medium">{u.name}</p>
                {u.error ? (
                  <p className="mt-0.5 text-caption text-red" role="alert">
                    {u.error}
                  </p>
                ) : (
                  <div className="mt-2 flex items-center gap-3">
                    <ProgressBar value={u.progress} label={`Uploading ${u.name}`} />
                    <span className="w-16 shrink-0 text-right text-caption tabular-nums text-secondary">
                      {u.progress >= 100 ? 'Saving…' : `${Math.round(u.progress)}%`}
                    </span>
                  </div>
                )}
              </div>
              {u.error && (
                <IconButton label={`Dismiss ${u.name}`} size="sm" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>
                  <X />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Row ---------------------------------------------------------------------------------------

function DocumentRow({ doc, onDeleted }: { doc: Doc; onDeleted: (id: string) => void }) {
  const { isAdmin, company } = useSession();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.deleteDocument(doc.id),
    onSuccess: () => {
      onDeleted(doc.id);
      toast.success(`Deleted “${doc.title}”.`);
    },
    onError: (e) => {
      setConfirming(false);
      toast.error(errorMessage(e));
    },
  });

  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-input bg-surface">
          <FileText className="h-5 w-5 text-secondary" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-body font-semibold">{doc.title}</p>
          <p className="truncate text-small text-secondary">
            {doc.filename} · {formatDateTime(doc.createdAt, company.timezone)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 pl-14 sm:pl-0">
        <DocStatus doc={doc} />
        {isAdmin &&
          (confirming ? (
            <div className="flex items-center gap-2 animate-fade-in">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={remove.isPending}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
                Delete
              </Button>
            </div>
          ) : (
            <IconButton label={`Delete ${doc.title}`} size="sm" onClick={() => setConfirming(true)}>
              <Trash2 />
            </IconButton>
          ))}
      </div>
    </li>
  );
}

function DocStatus({ doc }: { doc: Doc }) {
  if (doc.status === 'READY') {
    const meta = [doc.pages != null && plural(doc.pages, 'page'), doc.chunks != null && plural(doc.chunks, 'chunk')]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className="flex flex-col items-start sm:items-end">
        <StatusDot tone="green">Ready</StatusDot>
        {meta && <span className="text-caption text-tertiary">{meta}</span>}
      </div>
    );
  }
  if (doc.status === 'FAILED') {
    return (
      <div className="flex max-w-[260px] flex-col items-start sm:items-end">
        <StatusDot tone="red">Failed</StatusDot>
        {doc.error && <span className="text-caption text-secondary sm:text-right">{doc.error}</span>}
      </div>
    );
  }
  const queued = doc.status === 'QUEUED';
  return (
    <div className="flex w-44 flex-col gap-2">
      <div className="flex items-baseline justify-between text-small">
        <span className="font-medium text-secondary">{queued ? 'Queued' : 'Indexing'}</span>
        {!queued && <span className="tabular-nums text-tertiary">{Math.round(doc.progress)}%</span>}
      </div>
      <ProgressBar value={doc.progress} indeterminate={queued && doc.progress === 0} label={`Indexing ${doc.title}`} />
    </div>
  );
}
