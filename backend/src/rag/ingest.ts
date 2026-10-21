import { randomUUID } from 'node:crypto';
import { Prisma, type Document } from '@prisma/client';
import { prisma } from '../db.js';
import { getEmbeddingProvider } from '../ai/embeddings.js';
import { toDocDto } from '../lib/dto.js';
import { emitDocumentStatus } from '../realtime/socket.js';
import { logger } from '../logger.js';
import { chunkPages } from './chunker.js';
import { extractPages } from './extract.js';

const EMBED_BATCH = 64;
const INSERT_BATCH = 100;

class DocumentGoneError extends Error {}

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Ingestion pipeline for one document: extract (per page) → chunk → embed (batched) → store.
 * Emits `document:status` after every step. Idempotent: re-running replaces the document's chunks.
 * Called by the BullMQ worker, and directly (synchronously) by the seed script.
 */
export async function ingestDocument(documentId: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return; // deleted before the job ran

  const update = async (data: Prisma.DocumentUpdateInput): Promise<Document> => {
    try {
      const updated = await prisma.document.update({ where: { id: documentId }, data });
      emitDocumentStatus(updated.companyId, toDocDto(updated));
      return updated;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new DocumentGoneError();
      throw err;
    }
  };

  try {
    await update({ status: 'PROCESSING', progress: 5, error: null });

    const pages = await extractPages(doc.storagePath, doc.mimeType);
    const nonEmpty = pages.filter((p) => p.text.trim().length > 0);
    if (nonEmpty.length === 0) throw new Error('No extractable text found (is this a scanned PDF?)');
    await update({ progress: 25, pages: pages.length });

    const chunks = chunkPages(nonEmpty);
    await update({ progress: 35 });

    const embedder = getEmbeddingProvider();
    const vectors: number[][] = [];
    for (const batch of batches(chunks, EMBED_BATCH)) {
      vectors.push(...(await embedder.embed(batch.map((c) => c.content))));
      await update({ progress: 35 + Math.round((55 * vectors.length) / chunks.length) });
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.chunk.deleteMany({ where: { documentId } });
        for (const rows of batches(chunks.map((c, i) => ({ ...c, vector: vectors[i]! })), INSERT_BATCH)) {
          const values = rows.map(
            (r) =>
              Prisma.sql`(${randomUUID()}, ${doc.companyId}, ${documentId}, ${r.chunkIndex}, ${r.page}, ${r.content}, ${`[${r.vector.join(',')}]`}::vector)`,
          );
          await tx.$executeRaw`INSERT INTO "Chunk" (id, "companyId", "documentId", "chunkIndex", page, content, embedding) VALUES ${Prisma.join(values)}`;
        }
      },
      { timeout: 60_000 },
    );

    await update({ status: 'READY', progress: 100, chunkCount: chunks.length, embeddingModel: embedder.id });
    logger.info({ documentId, pages: pages.length, chunks: chunks.length }, 'document ingested');
  } catch (err) {
    if (err instanceof DocumentGoneError) {
      logger.info({ documentId }, 'document deleted during ingestion; skipping');
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ documentId, err }, 'document ingestion failed');
    try {
      await update({ status: 'FAILED', error: message.slice(0, 500) });
    } catch {
      /* document gone */
    }
    throw err;
  }
}
