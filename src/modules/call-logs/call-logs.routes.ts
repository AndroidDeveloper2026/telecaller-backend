import { Router } from 'express';
import { z } from 'zod';
import { CALL_STATUS, CallLog, Contact, User } from '../../models';
import { api, badRequest, forbidden, notFound, validate } from '../../common/http';
import { AuthUser } from '../../common/auth';
import { esc, objectId, oid, pageOf, pageQuery, paging } from '../../common/util';
import { toAdmins, toUser } from '../../common/socket';
import { getDispositions } from '../settings/settings.routes';

const cs = z.enum(CALL_STATUS as [string, ...string[]]); const iso = z.string().datetime({ offset: true });
const createS = z.object({ contactId: objectId, startTime: iso, endTime: iso.optional(), duration: z.coerce.number().int().min(0).optional(), callStatus: cs.optional(), disposition: z.string(), notes: z.string().max(2000).optional(), followUpAt: iso.optional(), durationSource: z.enum(['MANUAL', 'DEVICE']).optional(), clientId: z.string().max(64).optional() }).strict();
const updateS = z.object({ disposition: z.string().optional(), notes: z.string().max(2000).optional(), callStatus: cs.optional(), followUpAt: iso.optional() }).strict();
export const logQuery = pageQuery.extend({ employeeId: objectId.optional(), contactId: objectId.optional(), from: z.string().optional(), to: z.string().optional(), disposition: z.string().optional(), callStatus: cs.optional() });

export async function buildFilter(q: any, u: AuthUser) {
  const f: any = {};
  if (u.role === 'EMPLOYEE') f.employee = oid(u.id); else if (q.employeeId) f.employee = oid(q.employeeId);
  if (q.contactId) f.contact = oid(q.contactId); if (q.disposition) f.disposition = q.disposition; if (q.callStatus) f.callStatus = q.callStatus;
  if (q.from || q.to) { f.startTime = {}; if (q.from) f.startTime.$gte = new Date(q.from); if (q.to) { const t = new Date(q.to); if (q.to.length <= 10) t.setUTCHours(23, 59, 59, 999); f.startTime.$lte = t; } }
  if (q.search) { const r = new RegExp(esc(q.search), 'i'); const ids = (await Contact.find({ $or: [{ name: r }, { phone: r }, { company: r }] }).select('_id').limit(500).lean()).map((c: any) => c._id); f.$or = [{ contact: { $in: ids } }, { notes: r }]; }
  return f;
}
export async function listAllLogs(q: any, u: AuthUser, cap = 50000) {
  return CallLog.find(await buildFilter(q, u)).populate('contact', 'name phone company').populate('employee', 'name').sort({ startTime: -1 }).limit(cap).lean();
}
async function getLog(id: string, u: AuthUser) {
  const l: any = await CallLog.findById(id).populate('contact', 'name phone company email city').populate('employee', 'name email').lean(); if (!l) throw notFound('Call log not found');
  if (u.role === 'EMPLOYEE' && String(l.employee._id) !== u.id) throw forbidden('Not your call record'); return l;
}
async function dispo(key: string) { const d = (await getDispositions()).find((x) => x.key === key); if (!d) throw badRequest('Unknown disposition'); return d; }

export const callLogsRouter = Router(); const r = api(callLogsRouter, 'call-logs', '/call-logs');
r('post', '/', ['EMPLOYEE'], 'Log a call (idempotent by clientId)', validate({ body: createS }), async (req) => {
  const d = req.body; const u = req.user!;
  if (d.clientId) { const ex = await CallLog.findOne({ clientId: d.clientId, employee: oid(u.id) }).lean(); if (ex) return ex; }
  const contact: any = await Contact.findById(d.contactId).lean(); if (!contact || String(contact.assignedTo) !== u.id) throw forbidden('Contact is not assigned to you');
  const disp = await dispo(d.disposition); const start = new Date(d.startTime); const end = d.endTime ? new Date(d.endTime) : undefined;
  if (end && end < start) throw badRequest('endTime must be after startTime');
  const duration = d.duration ?? (end ? Math.round((+end - +start) / 1000) : 0);
  const log = await CallLog.create({ contact: contact._id, employee: u.id, startTime: start, endTime: end, duration, callStatus: d.callStatus || 'CONNECTED', disposition: d.disposition, notes: d.notes, followUpAt: d.followUpAt ? new Date(d.followUpAt) : undefined, durationSource: d.durationSource || 'MANUAL', clientId: d.clientId });
  const status = disp.outcome === 'COMPLETED' ? 'COMPLETED' : disp.outcome === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'IN_PROGRESS';
  const upd: any = { $inc: { callCount: 1 }, $set: { status, lastCalledAt: start, lastDisposition: d.disposition, lastNote: d.notes } };
  if (status === 'FOLLOW_UP') upd.$set.followUpAt = d.followUpAt ? new Date(d.followUpAt) : new Date(Date.now() + 86400000); else upd.$unset = { followUpAt: 1 };
  await Contact.updateOne({ _id: contact._id }, upd); await User.updateOne({ _id: u.id }, { presence: 'AVAILABLE' });
  toAdmins('call.updated', { id: log._id, employeeId: u.id, employeeName: u.name, contactName: contact.name, disposition: d.disposition, duration, at: start }); toAdmins('dashboard.refresh', {}); toUser(u.id, 'call.updated', { id: log._id });
  return log;
});
r('get', '/', 'any', 'List call logs (employees see only their own)', validate({ query: logQuery }), async (req) => {
  const q = req.q; const f = await buildFilter(q, req.user!); const p = paging(q, ['startTime', 'duration', 'disposition', 'callStatus', 'createdAt'], 'startTime');
  const [items, total] = await Promise.all([CallLog.find(f).populate('contact', 'name phone company').populate('employee', 'name').sort(p.sort).skip(p.skip).limit(p.limit).lean(), CallLog.countDocuments(f)]);
  return pageOf(items, total, p.page, p.limit);
});
r('get', '/:id', 'any', 'Call details', (req) => getLog(objectId.parse(req.params.id), req.user!));
r('patch', '/:id', 'any', 'Update disposition / notes', validate({ body: updateS }), async (req) => {
  const id = objectId.parse(req.params.id); const l = await getLog(id, req.user!); if (req.body.disposition) await dispo(req.body.disposition);
  const nl: any = await CallLog.findByIdAndUpdate(id, { ...req.body, followUpAt: req.body.followUpAt ? new Date(req.body.followUpAt) : undefined }, { new: true }).lean();
  if (req.body.disposition) await Contact.updateOne({ _id: l.contact._id, lastCalledAt: { $lte: l.startTime } }, { lastDisposition: req.body.disposition, lastNote: req.body.notes });
  toAdmins('call.updated', { id, employeeId: String(l.employee._id), disposition: nl.disposition }); toAdmins('dashboard.refresh', {}); return nl;
});
