import { Router } from 'express';
import { z } from 'zod';
import { authenticate, getAuth } from '../../middleware/auth.js';
import { parse } from '../../lib/validation.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../logger.js';
import { runChat, type ChatEvent } from './agent.js';

export const chatRouter = Router();
chatRouter.use(authenticate);

const ChatBody = z.object({
  message: z.string().trim().min(1, 'Message is required').max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(50)
    .optional()
    .default([]),
});

/** POST /api/chat → Server-Sent Events: tool* → token+ → citations → done (or error). */
chatRouter.post('/', async (req, res) => {
  const auth = getAuth(req);
  const body = parse(ChatBody, req.body); // validation errors are still plain JSON 400s

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });

  const write = (event: string, data: unknown) => {
    if (res.writableEnded || abort.signal.aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // SSE comment heartbeat keeps proxies from closing the stream during slow model calls.
  const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);

  try {
    await runChat({
      auth,
      message: body.message,
      history: body.history,
      signal: abort.signal,
      emit: (e: ChatEvent) => write(e.event, e.data),
    });
  } catch (err) {
    if (!abort.signal.aborted) {
      logger.error({ err }, 'chat failed');
      const message = err instanceof AppError ? err.message : 'The assistant ran into a problem. Please try again.';
      write('error', { message });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});
