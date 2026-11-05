import { Router } from 'express';
import { z } from 'zod';
import { Contact, User } from '../../models';
import { api, notFound, validate } from '../../common/http';
import { objectId, pageQuery } from '../../common/util';
import { createUser, hash, listUsers, sanitize } from '../users/users.service';
import { employeeStats } from '../dashboard/dashboard.routes';

const id = z.object({ id: objectId });
const create = z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().optional(), password: z.string().min(8).max(72) }).strict();
const update = z.object({ name: z.string().min(2).optional(), email: z.string().email().optional(), phone: z.string().optional() }).strict();
const listQ = pageQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional(), presence: z.string().optional() });
const params = (req: any) => id.parse(req.params).id;

export const employeesRouter = Router(); const r = api(employeesRouter, 'employees', '/employees'); const A: ['ADMIN'] = ['ADMIN'];
r('get', '/', A, 'List employees', validate({ query: listQ }), async (req) => {
  const page: any = await listUsers(req.q); const ids = page.items.map((i: any) => i._id);
  const counts = await Contact.aggregate([{ $match: { assignedTo: { $in: ids } } }, { $group: { _id: '$assignedTo', n: { $sum: 1 } } }]); const m = new Map(counts.map((c: any) => [String(c._id), c.n]));
  page.items = page.items.map((i: any) => ({ ...i, passwordHash: undefined, refreshTokenHash: undefined, assignedCount: m.get(String(i._id)) || 0 })); return page;
});
r('post', '/', A, 'Create employee', validate({ body: create }), (req) => createUser({ ...req.body, role: 'EMPLOYEE' }));
r('get', '/:id', A, 'Employee details with performance', async (req) => {
  const u: any = await User.findOne({ _id: params(req), role: 'EMPLOYEE' }).lean(); if (!u) throw notFound('Employee not found');
  return { ...sanitize(u), performance: await employeeStats(String(u._id)) };
});
r('patch', '/:id', A, 'Edit employee', validate({ body: update }), async (req) => {
  const u = await User.findOneAndUpdate({ _id: params(req), role: 'EMPLOYEE' }, req.body, { new: true }).lean(); if (!u) throw notFound('Employee not found'); return sanitize(u);
});
r('patch', '/:id/status', A, 'Activate / deactivate', validate({ body: z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).strict() }), async (req) => {
  const u = await User.findOneAndUpdate({ _id: params(req), role: 'EMPLOYEE' }, { status: req.body.status, ...(req.body.status === 'INACTIVE' ? { presence: 'OFFLINE', $unset: { refreshTokenHash: 1 } } : {}) }, { new: true }).lean();
  if (!u) throw notFound('Employee not found'); return sanitize(u);
});
r('post', '/:id/reset-password', A, 'Reset password', validate({ body: z.object({ password: z.string().min(8).max(72) }).strict() }), async (req) => {
  const x = await User.updateOne({ _id: params(req), role: 'EMPLOYEE' }, { passwordHash: await hash(req.body.password), $unset: { refreshTokenHash: 1 } }); if (!x.matchedCount) throw notFound('Employee not found'); return { ok: true };
});
r('get', '/:id/performance', A, 'Employee performance', async (req) => {
  if (!(await User.exists({ _id: params(req), role: 'EMPLOYEE' }))) throw notFound('Employee not found'); return employeeStats(params(req));
});
