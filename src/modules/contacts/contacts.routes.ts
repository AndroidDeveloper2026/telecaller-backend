import { Router } from 'express';
import { z } from 'zod';
import { Contact, CONTACT_STATUS } from '../../models';
import { api, conflict, forbidden, notFound, validate } from '../../common/http';
import { AuthUser } from '../../common/auth';
import { esc, normalizePhone, objectId, oid, pageOf, pageQuery, paging } from '../../common/util';
import { toAdmins, toUser } from '../../common/socket';

const idP = (req: any) => objectId.parse(req.params.id);
const fields = { name: z.string().min(1), phone: z.string(), email: z.string().email().optional(), company: z.string().optional(), city: z.string().optional(), priority: z.coerce.number().int().min(1).max(3).optional() };
const createS = z.object(fields).strict(); const updateS = z.object(fields).partial().strict();
const listQ = pageQuery.extend({ status: z.enum(CONTACT_STATUS as [string, ...string[]]).optional(), assignedTo: objectId.optional(), unassigned: z.string().optional(), priority: z.coerce.number().int().optional(), disposition: z.string().optional(), followUps: z.string().optional() });

function scope(q: any, u: AuthUser) {
  const f: any = {};
  if (u.role === 'EMPLOYEE') f.assignedTo = oid(u.id); else if (q.unassigned === 'true') f.assignedTo = null; else if (q.assignedTo) f.assignedTo = oid(q.assignedTo);
  if (q.status) f.status = q.status; if (q.followUps === 'true') f.status = 'FOLLOW_UP'; if (q.priority) f.priority = q.priority; if (q.disposition) f.lastDisposition = q.disposition;
  if (q.search) { const r = new RegExp(esc(q.search), 'i'); f.$or = [{ name: r }, { phone: r }, { company: r }, { email: r }, { city: r }]; }
  return f;
}
export async function getContact(id: string, u: AuthUser) {
  const c: any = await Contact.findById(id).populate('assignedTo', 'name').lean(); if (!c) throw notFound('Contact not found');
  if (u.role === 'EMPLOYEE' && String(c.assignedTo?._id) !== u.id) throw forbidden('Not your contact'); return c;
}
const changed = (c: any) => { if (c?.assignedTo) toUser(String(c.assignedTo), 'contact.updated', c); toAdmins('dashboard.refresh', {}); };

export const contactsRouter = Router(); const r = api(contactsRouter, 'contacts', '/contacts');
r('get', '/', 'any', 'List contacts (employees see only their own)', validate({ query: listQ }), async (req) => {
  const q = req.q; const f = scope(q, req.user!); const p = paging(q, ['name', 'phone', 'company', 'status', 'priority', 'createdAt', 'lastCalledAt', 'followUpAt']);
  const [items, total] = await Promise.all([Contact.find(f).populate('assignedTo', 'name').sort(p.sort).skip(p.skip).limit(p.limit).lean(), Contact.countDocuments(f)]);
  return pageOf(items, total, p.page, p.limit);
});
r('get', '/queue', ['EMPLOYEE'], 'My work queue (priority first)', async (req) => ({
  items: await Contact.find({ assignedTo: oid(req.user!.id), status: { $in: ['ASSIGNED', 'IN_PROGRESS', 'FOLLOW_UP'] } }).sort({ priority: 1, followUpAt: 1, createdAt: 1 }).limit(20).lean(),
}));
r('post', '/', ['ADMIN'], 'Add contact', validate({ body: createS }), async (req) => {
  const phone = normalizePhone(req.body.phone); if (!phone) throw conflict('Invalid phone number');
  if (await Contact.exists({ phone })) throw conflict('A contact with this phone number already exists');
  return Contact.create({ ...req.body, phone, createdBy: req.user!.id });
});
r('get', '/:id', 'any', 'Contact details', (req) => getContact(idP(req), req.user!));
r('patch', '/:id', ['ADMIN'], 'Edit contact', validate({ body: updateS }), async (req) => {
  const patch: any = { ...req.body };
  if (patch.phone) { const phone = normalizePhone(patch.phone); if (!phone) throw conflict('Invalid phone number'); if (await Contact.exists({ phone, _id: { $ne: idP(req) } })) throw conflict('A contact with this phone number already exists'); patch.phone = phone; }
  const c = await Contact.findByIdAndUpdate(idP(req), patch, { new: true }).lean(); if (!c) throw notFound('Contact not found'); return c;
});
r('delete', '/:id', ['ADMIN'], 'Delete contact', async (req) => { const x = await Contact.deleteOne({ _id: idP(req) }); if (!x.deletedCount) throw notFound('Contact not found'); return { ok: true }; });
r('patch', '/:id/complete', 'any', 'Mark contact completed', async (req) => {
  await getContact(idP(req), req.user!); const c = await Contact.findByIdAndUpdate(idP(req), { status: 'COMPLETED', $unset: { followUpAt: 1 } }, { new: true }).lean(); changed(c); return c;
});
r('patch', '/:id/follow-up', 'any', 'Schedule follow-up', validate({ body: z.object({ followUpAt: z.string().datetime({ offset: true }) }).strict() }), async (req) => {
  await getContact(idP(req), req.user!); const c = await Contact.findByIdAndUpdate(idP(req), { status: 'FOLLOW_UP', followUpAt: new Date(req.body.followUpAt) }, { new: true }).lean(); changed(c); return c;
});
