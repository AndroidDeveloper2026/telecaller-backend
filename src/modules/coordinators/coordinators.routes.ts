import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../models';
import { api, badRequest, notFound, validate } from '../../common/http';
import { objectId, pageQuery } from '../../common/util';
import { createUser, hash, listUsers, sanitize } from '../users/users.service';

const id = z.object({ id: objectId }); const params = (req: any) => id.parse(req.params).id;
const create = z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().optional(), password: z.string().min(8).max(72), employeeIds: z.array(objectId).optional() }).strict();
const update = z.object({ name: z.string().min(2).optional(), email: z.string().email().optional(), phone: z.string().optional() }).strict();
const listQ = pageQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
const A: ['ADMIN'] = ['ADMIN'];
const setTeam = async (leadId: string, employeeIds: string[]) => {
  await User.updateMany({ role: 'EMPLOYEE', teamLead: leadId }, { teamLead: null });
  if (employeeIds.length) await User.updateMany({ _id: { $in: employeeIds }, role: 'EMPLOYEE' }, { teamLead: leadId });
};

export const coordinatorsRouter = Router(); const r = api(coordinatorsRouter, 'coordinators', '/coordinators');
r('get', '/', A, 'List Operations Coordinators', validate({ query: listQ }), async (req) => {
  const page: any = await listUsers(req.q, 'COORDINATOR'); const ids = page.items.map((i: any) => i._id);
  const counts = await User.aggregate([{ $match: { role: 'EMPLOYEE', teamLead: { $in: ids } } }, { $group: { _id: '$teamLead', n: { $sum: 1 } } }]); const m = new Map(counts.map((c: any) => [String(c._id), c.n]));
  page.items = page.items.map((i: any) => ({ ...sanitize(i), teamSize: m.get(String(i._id)) || 0 })); return page;
});
r('post', '/', A, 'Create Operations Coordinator', validate({ body: create }), async (req) => {
  const { employeeIds, ...d } = req.body; const u: any = await createUser({ ...d, role: 'COORDINATOR' }); if (employeeIds?.length) await setTeam(String(u._id), employeeIds); return u;
});
r('get', '/:id', A, 'Coordinator with team members', async (req) => {
  const u: any = await User.findOne({ _id: params(req), role: 'COORDINATOR' }).lean(); if (!u) throw notFound('Coordinator not found');
  return { ...sanitize(u), team: await User.find({ role: 'EMPLOYEE', teamLead: u._id }).select('name email presence status').sort({ name: 1 }).lean() };
});
r('patch', '/:id', A, 'Edit coordinator', validate({ body: update }), async (req) => {
  const u = await User.findOneAndUpdate({ _id: params(req), role: 'COORDINATOR' }, req.body, { new: true }).lean(); if (!u) throw notFound('Coordinator not found'); return sanitize(u);
});
r('put', '/:id/team', A, 'Set the coordinator\'s team (replaces current members)', validate({ body: z.object({ employeeIds: z.array(objectId) }).strict() }), async (req) => {
  if (!(await User.exists({ _id: params(req), role: 'COORDINATOR', status: 'ACTIVE' }))) throw badRequest('Coordinator not found or inactive');
  await setTeam(params(req), req.body.employeeIds); return { ok: true, teamSize: req.body.employeeIds.length };
});
r('patch', '/:id/status', A, 'Activate / deactivate', validate({ body: z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).strict() }), async (req) => {
  const u = await User.findOneAndUpdate({ _id: params(req), role: 'COORDINATOR' }, { status: req.body.status, ...(req.body.status === 'INACTIVE' ? { $unset: { refreshTokenHash: 1 } } : {}) }, { new: true }).lean();
  if (!u) throw notFound('Coordinator not found'); return sanitize(u);
});
r('post', '/:id/reset-password', A, 'Reset password', validate({ body: z.object({ password: z.string().min(8).max(72) }).strict() }), async (req) => {
  const x = await User.updateOne({ _id: params(req), role: 'COORDINATOR' }, { passwordHash: await hash(req.body.password), $unset: { refreshTokenHash: 1 } }); if (!x.matchedCount) throw notFound('Coordinator not found'); return { ok: true };
});


//----- second change --------
// import { Router } from 'express';
// import { z } from 'zod';
// import { User } from '../../models';
// import { api, badRequest, notFound, validate } from '../../common/http';
// import { objectId, pageQuery } from '../../common/util';
// import { createUser, hash, listUsers, sanitize } from '../users/users.service';

// const id = z.object({ id: objectId }); const params = (req: any) => id.parse(req.params).id;
// const create = z.object({ name: z.string().min(2), email: z.string().email(), phone: z.string().optional(), password: z.string().min(8).max(72), employeeIds: z.array(objectId).optional() }).strict();
// const update = z.object({ name: z.string().min(2).optional(), email: z.string().email().optional(), phone: z.string().optional() }).strict();
// const listQ = pageQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
// const A: ['ADMIN'] = ['ADMIN'];
// const setTeam = async (leadId: string, employeeIds: string[]) => {
//   await User.updateMany({ role: 'EMPLOYEE', teamLead: leadId }, { teamLead: null });
//   if (employeeIds.length) await User.updateMany({ _id: { $in: employeeIds }, role: 'EMPLOYEE' }, { teamLead: leadId });
// };

// export const coordinatorsRouter = Router(); const r = api(coordinatorsRouter, 'coordinators', '/coordinators');
// r('get', '/', A, 'List Operations Coordinators', validate({ query: listQ }), async (req) => {
//   const page: any = await listUsers(req.q, 'COORDINATOR'); const ids = page.items.map((i: any) => i._id);
//   const counts = await User.aggregate([{ $match: { role: 'EMPLOYEE', teamLead: { $in: ids } } }, { $group: { _id: '$teamLead', n: { $sum: 1 } } }]); const m = new Map(counts.map((c: any) => [String(c._id), c.n]));
//   page.items = page.items.map((i: any) => ({ ...sanitize(i), teamSize: m.get(String(i._id)) || 0 })); return page;
// });
// r('post', '/', A, 'Create Operations Coordinator', validate({ body: create }), async (req) => {
//   const { employeeIds, ...d } = req.body; const u: any = await createUser({ ...d, role: 'COORDINATOR' }); if (employeeIds?.length) await setTeam(String(u._id), employeeIds); return u;
// });
// r('get', '/:id', A, 'Coordinator with team members', async (req) => {
//   const u: any = await User.findOne({ _id: params(req), role: 'COORDINATOR' }).lean(); if (!u) throw notFound('Coordinator not found');
//   return { ...sanitize(u), team: await User.find({ role: 'EMPLOYEE', teamLead: u._id }).select('name email presence status').sort({ name: 1 }).lean() };
// });
// r('patch', '/:id', A, 'Edit coordinator', validate({ body: update }), async (req) => {
//   const u = await User.findOneAndUpdate({ _id: params(req), role: 'COORDINATOR' }, req.body, { new: true }).lean(); if (!u) throw notFound('Coordinator not found'); return sanitize(u);
// });
// r('put', '/:id/team', A, 'Set the coordinator\'s team (replaces current members)', validate({ body: z.object({ employeeIds: z.array(objectId) }).strict() }), async (req) => {
//   if (!(await User.exists({ _id: params(req), role: 'COORDINATOR', status: 'ACTIVE' }))) throw badRequest('Coordinator not found or inactive');
//   await setTeam(params(req), req.body.employeeIds); return { ok: true, teamSize: req.body.employeeIds.length };
// });
// r('patch', '/:id/status', A, 'Activate / deactivate', validate({ body: z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).strict() }), async (req) => {
//   const u = await User.findOneAndUpdate({ _id: params(req), role: 'COORDINATOR' }, { status: req.body.status, ...(req.body.status === 'INACTIVE' ? { $unset: { refreshTokenHash: 1 } } : {}) }, { new: true }).lean();
//   if (!u) throw notFound('Coordinator not found'); return sanitize(u);
// });
// r('post', '/:id/reset-password', A, 'Reset password', validate({ body: z.object({ password: z.string().min(8).max(72) }).strict() }), async (req) => {
//   const x = await User.updateOne({ _id: params(req), role: 'COORDINATOR' }, { passwordHash: await hash(req.body.password), $unset: { refreshTokenHash: 1 } }); if (!x.matchedCount) throw notFound('Coordinator not found'); return { ok: true };
// });
