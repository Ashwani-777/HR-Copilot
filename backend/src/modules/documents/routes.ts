import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { config } from '../../config.js';
import { authenticate, getAuth, requireRole } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toDocDto } from '../../lib/dto.js';
import { parse } from '../../lib/validation.js';
import { emitDocumentStatus } from '../../realtime/socket.js';
import { enqueueIngestion } from '../../jobs/queue.js';
import { logger } from '../../logger.js';

export const documentsRouter = Router();
documentsRouter.use(authenticate);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = { '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!MIME_BY_EXT[ext]) return cb(badRequest('Only .pdf, .txt and .md files are supported', { field: 'file' }));
    cb(null, true);
  },
});

const uploadRoot = () => path.resolve(process.cwd(), config.UPLOAD_DIR);

/** Multer decodes multipart filenames as latin1; browsers send UTF-8. */
function decodeFilename(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

documentsRouter.get('/', async (req, res) => {
  const auth = getAuth(req);
  const docs = await prisma.document.findMany({ where: { companyId: auth.companyId }, orderBy: { createdAt: 'desc' } });
  res.json({ documents: docs.map(toDocDto) });
});

documentsRouter.post('/', requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  const auth = getAuth(req);
  const file = req.file;
  if (!file) throw badRequest('Attach a file in the `file` field', { field: 'file' });
  if (file.size === 0) throw badRequest('The file is empty', { field: 'file' });
  const { title } = parse(z.object({ title: z.string().trim().max(200).optional() }), req.body ?? {});

  const filename = decodeFilename(file.originalname);
  const ext = path.extname(filename).toLowerCase();
  const id = randomUUID();
  // Server-chosen path (uuid + whitelisted extension): user input never reaches the filesystem path.
  const dir = path.join(uploadRoot(), auth.companyId);
  const storagePath = path.join(dir, `${id}${ext}`);
  await mkdir(dir, { recursive: true });
  await writeFile(storagePath, file.buffer);

  const doc = await prisma.document.create({
    data: {
      id,
      companyId: auth.companyId,
      title: title || path.basename(filename, ext),
      filename,
      mimeType: MIME_BY_EXT[ext]!,
      storagePath,
      sizeBytes: file.size,
      uploadedById: auth.userId,
    },
  });

  try {
    await enqueueIngestion(doc.id);
  } catch (err) {
    logger.error({ err, documentId: doc.id }, 'failed to enqueue ingestion');
    const failed = await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'FAILED', error: 'Could not queue the document for processing (is Redis running?)' },
    });
    emitDocumentStatus(auth.companyId, toDocDto(failed));
    res.status(202).json(toDocDto(failed));
    return;
  }

  emitDocumentStatus(auth.companyId, toDocDto(doc));
  res.status(202).json(toDocDto(doc));
});

documentsRouter.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  const auth = getAuth(req);
  const doc = await prisma.document.findFirst({ where: { id: String(req.params.id), companyId: auth.companyId } });
  if (!doc) throw notFound('Document not found');
  await prisma.document.delete({ where: { id: doc.id } }); // chunks cascade
  await unlink(doc.storagePath).catch(() => undefined);
  res.status(204).end();
});
