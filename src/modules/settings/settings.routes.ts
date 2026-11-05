import { Router } from 'express';
import { z } from 'zod';
import { Setting } from '../../models';
import { api, validate } from '../../common/http';

export interface Disposition { key: string; label: string; outcome: 'COMPLETED' | 'RETRY' | 'FOLLOW_UP'; success: boolean }
export const DEFAULT_DISPOSITIONS: Disposition[] = [
  { key: 'INTERESTED', label: 'Interested', outcome: 'COMPLETED', success: true }, { key: 'NOT_INTERESTED', label: 'Not Interested', outcome: 'COMPLETED', success: false },
  { key: 'FOLLOW_UP_REQUIRED', label: 'Follow-up Required', outcome: 'FOLLOW_UP', success: false }, { key: 'NO_ANSWER', label: 'No Answer', outcome: 'RETRY', success: false },
  { key: 'BUSY', label: 'Busy', outcome: 'RETRY', success: false }, { key: 'NOT_REACHABLE', label: 'Not Reachable', outcome: 'RETRY', success: false },
  { key: 'WRONG_NUMBER', label: 'Wrong Number', outcome: 'COMPLETED', success: false }, { key: 'CALL_BACK_LATER', label: 'Call Back Later', outcome: 'FOLLOW_UP', success: false },
  { key: 'COMPLETED', label: 'Completed', outcome: 'COMPLETED', success: true },
];
export async function getSettings() {
  const rows = await Setting.find().lean(); const m: any = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  return { dispositions: (m.dispositions as Disposition[]) || DEFAULT_DISPOSITIONS, companyName: (m.companyName as string) || 'Radnus Connect' };
}
export const getDispositions = async () => (await getSettings()).dispositions;

const update = z.object({
  dispositions: z.array(z.object({ key: z.string().regex(/^[A-Z0-9_]{2,40}$/), label: z.string().min(1), outcome: z.enum(['COMPLETED', 'RETRY', 'FOLLOW_UP']), success: z.boolean() }).strict()).min(1).optional(),
  companyName: z.string().optional(),
}).strict();

export const settingsRouter = Router(); const r = api(settingsRouter, 'settings', '/settings');
r('get', '/', 'any', 'Get settings and dispositions', () => getSettings());
r('put', '/', ['ADMIN'], 'Update settings', validate({ body: update }), async (req) => {
  for (const k of ['dispositions', 'companyName'] as const) if (req.body[k] !== undefined) await Setting.updateOne({ key: k }, { value: req.body[k] }, { upsert: true });
  return getSettings();
});
