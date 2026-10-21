import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../logger.js';

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof z.ZodError) {
    const flat = z.flattenError(err);
    const first = err.issues[0];
    const where = first?.path.length ? `${first.path.join('.')}: ` : '';
    return new AppError(400, 'VALIDATION_ERROR', `${where}${first?.message ?? 'Invalid request'}`, {
      fieldErrors: flat.fieldErrors,
      formErrors: flat.formErrors,
    });
  }

  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 10 MB)' : `Upload error: ${err.message}`;
    return new AppError(400, 'VALIDATION_ERROR', message, { field: err.field ?? 'file' });
  }

  // body-parser JSON syntax errors
  if (typeof err === 'object' && err !== null && 'type' in err && (err as { type?: string }).type === 'entity.parse.failed') {
    return new AppError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON');
  }
  if (typeof err === 'object' && err !== null && 'type' in err && (err as { type?: string }).type === 'entity.too.large') {
    return new AppError(400, 'VALIDATION_ERROR', 'Request body is too large');
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return new AppError(404, 'NOT_FOUND', 'Not found');
    if (err.code === 'P2002') return new AppError(400, 'VALIDATION_ERROR', 'A record with these values already exists');
  }

  return new AppError(500, 'INTERNAL', 'Something went wrong');
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = toAppError(err);
  if (appError.status >= 500) {
    logger.error({ err, path: req.path }, 'unhandled error');
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  const body: ErrorBody = { error: { code: appError.code, message: appError.message, details: appError.details } };
  res.status(appError.status).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}`, details: {} } });
}
