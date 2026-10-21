import { z } from 'zod';
import { isValidDateStr } from './time.js';

export const dateStr = z
  .string()
  .refine(isValidDateStr, { message: 'Expected a date in YYYY-MM-DD format' });

/** Parse with a Zod schema; ZodErrors are turned into 400 VALIDATION_ERROR by the error handler. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}
