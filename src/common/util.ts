import { Types } from 'mongoose';
import { z } from 'zod';

export const oid = (id: string) => new Types.ObjectId(id);
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().optional(), order: z.enum(['asc', 'desc']).default('desc'), search: z.string().optional(),
});
export const paging = (q: { page: number; limit: number; sort?: string; order: string }, allowed: string[], fallback = 'createdAt') => {
  const field = q.sort && allowed.includes(q.sort) ? q.sort : fallback;
  return { page: q.page, limit: q.limit, skip: (q.page - 1) * q.limit, sort: { [field]: q.order === 'asc' ? 1 : -1 } as any };
};
export const pageOf = <T>(items: T[], total: number, page: number, limit: number) => ({ items, total, page, limit, pages: Math.ceil(total / limit) || 1 });
export const normalizePhone = (p: unknown): string | null => {
  const raw = String(p ?? '').trim(); const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (raw.startsWith('+') ? '+' : '') + digits;
};
export const TZ = () => process.env.TIMEZONE || 'Asia/Kolkata';
export const dayStr = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ() }).format(d);
