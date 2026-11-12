import { Router } from 'express';
import { z } from 'zod';
import { Assignment, Contact, User } from '../../models';
import { api, badRequest, forbidden, validate } from '../../common/http';
import { teamOf } from '../users/users.service';
import { objectId, oid, pageOf, pageQuery, paging } from '../../common/util';
import { toAdmins, toLead, toUser } from '../../common/socket';
import { notify } from '../notifications/notifications.routes';

async function apply(employeeId: string, contactIds: string[], by: string) {
  const ids = contactIds.map(oid); const now = new Date();
  await Assignment.updateMany({ contact: { $in: ids }, status: 'ACTIVE' }, { status: 'REASSIGNED' });
  const res = await Contact.updateMany({ _id: { $in: ids }, status: { $ne: 'COMPLETED' } }, [{ $set: { assignedTo: oid(employeeId), assignedAt: now, status: { $cond: [{ $in: ['$status', ['NEW', 'ASSIGNED']] }, 'ASSIGNED', '$status'] } } }]);
  const done = await Contact.find({ _id: { $in: ids }, assignedTo: oid(employeeId) }).select('_id').lean();
  if (done.length) await Assignment.insertMany(done.map((c: any) => ({ contact: c._id, employee: oid(employeeId), assignedBy: oid(by), status: 'ACTIVE' })));
  return { assigned: done.length, skipped: ids.length - done.length, matched: res.matchedCount };
}
async function announce(employeeId: string, count: number) {
  toUser(employeeId, 'assignment.updated', { count }); toAdmins('dashboard.refresh', {}); toLead(employeeId, 'dashboard.refresh', {});
  await notify(employeeId, 'New contacts assigned', `${count} contact${count === 1 ? '' : 's'} added to your queue`, 'ASSIGNMENT');
}
export async function assign(employeeId: string, contactIds: string[], by: string) {
  if (!(await User.exists({ _id: employeeId, role: 'EMPLOYEE', status: 'ACTIVE' }))) throw badRequest('Employee not found or inactive');
  const r = await apply(employeeId, contactIds, by); if (r.assigned) await announce(employeeId, r.assigned); return r;
}
/** Equal split across the given (default: all active) employees. */
export async function distribute(by: string, employeeIds?: string[], contactIds?: string[], poolOwner?: string) {
  const emps: any[] = await User.find({ role: 'EMPLOYEE', status: 'ACTIVE', ...(employeeIds?.length ? { _id: { $in: employeeIds.map(oid) } } : {}) }).select('_id').lean();
  if (!emps.length) throw badRequest('No active employees to distribute to');
  const ids = contactIds?.length ? contactIds : (await Contact.find({ assignedTo: null, status: { $ne: 'COMPLETED' }, ...(poolOwner ? { createdBy: oid(poolOwner) } : {}) }).select('_id').lean()).map((c: any) => String(c._id));
  if (!ids.length) throw badRequest('No contacts to distribute');
  const size = Math.ceil(ids.length / emps.length); const out: { employeeId: string; assigned: number }[] = [];
  for (let i = 0; i < emps.length; i++) {
    const chunk = ids.slice(i * size, (i + 1) * size); if (!chunk.length) break;
    const r = await apply(String(emps[i]._id), chunk, by); if (r.assigned) await announce(String(emps[i]._id), r.assigned); out.push({ employeeId: String(emps[i]._id), assigned: r.assigned });
  }
  return { total: ids.length, distribution: out };
}

/** Contacts a coordinator may allocate: their team's, plus unassigned ones they uploaded/added. */
const allowedContacts = async (leadId: string, ids: string[]) => {
  const team = await teamOf(leadId);
  return (await Contact.find({ _id: { $in: ids }, $or: [{ assignedTo: { $in: team } }, { assignedTo: null, createdBy: oid(leadId) }] }).select('_id').lean()).map((c: any) => String(c._id));
};
const ids = z.array(objectId); const AC: ['ADMIN', 'COORDINATOR'] = ['ADMIN', 'COORDINATOR'];
export const assignmentsRouter = Router(); const r = api(assignmentsRouter, 'assignments', '/assignments'); const A: ['ADMIN'] = ['ADMIN'];
r('post', '/assign', AC, 'Assign / reassign contacts to one employee (coordinators: own team only)', validate({ body: z.object({ employeeId: objectId, contactIds: ids.min(1).max(10000) }).strict() }), async (req) => {
  const u = req.user!; let cids: string[] = req.body.contactIds;
  if (u.role === 'COORDINATOR') {
    if (!(await User.exists({ _id: req.body.employeeId, role: 'EMPLOYEE', teamLead: u.id }))) throw forbidden('That telecaller is not in your team');
    cids = await allowedContacts(u.id, cids); if (!cids.length) throw badRequest('None of these contacts are yours to allocate');
  }
  return assign(req.body.employeeId, cids, u.id);
});
r('post', '/distribute', AC, 'Distribute contacts equally (coordinators: own team only)', validate({ body: z.object({ employeeIds: ids.optional(), contactIds: ids.optional() }).strict() }), async (req) => {
  const u = req.user!; if (u.role !== 'COORDINATOR') return distribute(u.id, req.body.employeeIds, req.body.contactIds);
  const team = (await teamOf(u.id)).map(String); if (!team.length) throw badRequest('You have no telecallers in your team yet');
  const emps = req.body.employeeIds?.length ? req.body.employeeIds : team; if (emps.some((e: string) => !team.includes(e))) throw forbidden('Some telecallers are not in your team');
  const cids = req.body.contactIds?.length ? await allowedContacts(u.id, req.body.contactIds) : undefined; if (req.body.contactIds?.length && !cids!.length) throw badRequest('None of these contacts are yours to allocate');
  return distribute(u.id, emps, cids, u.id);
});
r('get', '/', AC, 'Assignment history', validate({ query: pageQuery.extend({ employeeId: objectId.optional(), status: z.string().optional() }) }), async (req) => {
  const q = req.q; const f: any = {}; if (req.user!.role === 'COORDINATOR') { const team = await teamOf(req.user!.id); f.employee = { $in: q.employeeId ? team.filter((t: any) => String(t) === q.employeeId) : team }; } else if (q.employeeId) f.employee = oid(q.employeeId); if (q.status) f.status = q.status; const p = paging(q, ['assignedAt'], 'assignedAt');
  const [items, total] = await Promise.all([Assignment.find(f).populate('contact', 'name phone company status').populate('employee', 'name').populate('assignedBy', 'name').sort(p.sort).skip(p.skip).limit(p.limit).lean(), Assignment.countDocuments(f)]);
  return pageOf(items, total, p.page, p.limit);
});
r('get', '/summary', AC, 'Employee-wise workload', async (req) => {
  const lead = req.user!.role === 'COORDINATOR' ? req.user!.id : null; const team = lead ? await teamOf(lead) : null;
  const emps: any[] = await User.find({ role: 'EMPLOYEE', ...(team ? { _id: { $in: team } } : {}) }).select('name status presence').lean();
  const agg = await Contact.aggregate([{ $match: { assignedTo: team ? { $in: team } : { $ne: null } } }, { $group: { _id: { e: '$assignedTo', s: '$status' }, n: { $sum: 1 } } }]);
  const items = emps.map((e) => { const mine = agg.filter((a: any) => String(a._id.e) === String(e._id)); const by = (s: string) => mine.filter((m: any) => m._id.s === s).reduce((t: number, m: any) => t + m.n, 0);
    return { employeeId: e._id, name: e.name, status: e.status, total: mine.reduce((t: number, m: any) => t + m.n, 0), pending: by('ASSIGNED'), inProgress: by('IN_PROGRESS'), followUp: by('FOLLOW_UP'), completed: by('COMPLETED') }; });
  return { items, unassigned: await Contact.countDocuments({ assignedTo: null, ...(lead ? { createdBy: oid(lead) } : {}) }) };
});



//------ second change ----------
// import { Router } from 'express';
// import { z } from 'zod';
// import { Assignment, Contact, User } from '../../models';
// import { api, badRequest, forbidden, validate } from '../../common/http';
// import { teamOf } from '../users/users.service';
// import { objectId, oid, pageOf, pageQuery, paging } from '../../common/util';
// import { toAdmins, toLead, toUser } from '../../common/socket';
// import { notify } from '../notifications/notifications.routes';

// async function apply(employeeId: string, contactIds: string[], by: string) {
//   const ids = contactIds.map(oid); const now = new Date();
//   await Assignment.updateMany({ contact: { $in: ids }, status: 'ACTIVE' }, { status: 'REASSIGNED' });
//   const res = await Contact.updateMany({ _id: { $in: ids }, status: { $ne: 'COMPLETED' } }, [{ $set: { assignedTo: oid(employeeId), assignedAt: now, status: { $cond: [{ $in: ['$status', ['NEW', 'ASSIGNED']] }, 'ASSIGNED', '$status'] } } }]);
//   const done = await Contact.find({ _id: { $in: ids }, assignedTo: oid(employeeId) }).select('_id').lean();
//   if (done.length) await Assignment.insertMany(done.map((c: any) => ({ contact: c._id, employee: oid(employeeId), assignedBy: oid(by), status: 'ACTIVE' })));
//   return { assigned: done.length, skipped: ids.length - done.length, matched: res.matchedCount };
// }
// async function announce(employeeId: string, count: number) {
//   toUser(employeeId, 'assignment.updated', { count }); toAdmins('dashboard.refresh', {}); toLead(employeeId, 'dashboard.refresh', {});
//   await notify(employeeId, 'New contacts assigned', `${count} contact${count === 1 ? '' : 's'} added to your queue`, 'ASSIGNMENT');
// }
// export async function assign(employeeId: string, contactIds: string[], by: string) {
//   if (!(await User.exists({ _id: employeeId, role: 'EMPLOYEE', status: 'ACTIVE' }))) throw badRequest('Employee not found or inactive');
//   const r = await apply(employeeId, contactIds, by); if (r.assigned) await announce(employeeId, r.assigned); return r;
// }
// /** Equal split across the given (default: all active) employees. */
// export async function distribute(by: string, employeeIds?: string[], contactIds?: string[], poolOwner?: string) {
//   const emps: any[] = await User.find({ role: 'EMPLOYEE', status: 'ACTIVE', ...(employeeIds?.length ? { _id: { $in: employeeIds.map(oid) } } : {}) }).select('_id').lean();
//   if (!emps.length) throw badRequest('No active employees to distribute to');
//   const ids = contactIds?.length ? contactIds : (await Contact.find({ assignedTo: null, status: { $ne: 'COMPLETED' }, ...(poolOwner ? { createdBy: oid(poolOwner) } : {}) }).select('_id').lean()).map((c: any) => String(c._id));
//   if (!ids.length) throw badRequest('No contacts to distribute');
//   const size = Math.ceil(ids.length / emps.length); const out: { employeeId: string; assigned: number }[] = [];
//   for (let i = 0; i < emps.length; i++) {
//     const chunk = ids.slice(i * size, (i + 1) * size); if (!chunk.length) break;
//     const r = await apply(String(emps[i]._id), chunk, by); if (r.assigned) await announce(String(emps[i]._id), r.assigned); out.push({ employeeId: String(emps[i]._id), assigned: r.assigned });
//   }
//   return { total: ids.length, distribution: out };
// }

// /** Contacts a coordinator may allocate: their team's, plus unassigned ones they uploaded/added. */
// const allowedContacts = async (leadId: string, ids: string[]) => {
//   const team = await teamOf(leadId);
//   return (await Contact.find({ _id: { $in: ids }, $or: [{ assignedTo: { $in: team } }, { assignedTo: null, createdBy: oid(leadId) }] }).select('_id').lean()).map((c: any) => String(c._id));
// };
// const ids = z.array(objectId); const AC: ['ADMIN', 'COORDINATOR'] = ['ADMIN', 'COORDINATOR'];
// export const assignmentsRouter = Router(); const r = api(assignmentsRouter, 'assignments', '/assignments'); const A: ['ADMIN'] = ['ADMIN'];
// r('post', '/assign', AC, 'Assign / reassign contacts to one employee (coordinators: own team only)', validate({ body: z.object({ employeeId: objectId, contactIds: ids.min(1).max(10000) }).strict() }), async (req) => {
//   const u = req.user!; let cids: string[] = req.body.contactIds;
//   if (u.role === 'COORDINATOR') {
//     if (!(await User.exists({ _id: req.body.employeeId, role: 'EMPLOYEE', teamLead: u.id }))) throw forbidden('That telecaller is not in your team');
//     cids = await allowedContacts(u.id, cids); if (!cids.length) throw badRequest('None of these contacts are yours to allocate');
//   }
//   return assign(req.body.employeeId, cids, u.id);
// });
// r('post', '/distribute', AC, 'Distribute contacts equally (coordinators: own team only)', validate({ body: z.object({ employeeIds: ids.optional(), contactIds: ids.optional() }).strict() }), async (req) => {
//   const u = req.user!; if (u.role !== 'COORDINATOR') return distribute(u.id, req.body.employeeIds, req.body.contactIds);
//   const team = (await teamOf(u.id)).map(String); if (!team.length) throw badRequest('You have no telecallers in your team yet');
//   const emps = req.body.employeeIds?.length ? req.body.employeeIds : team; if (emps.some((e: string) => !team.includes(e))) throw forbidden('Some telecallers are not in your team');
//   const cids = req.body.contactIds?.length ? await allowedContacts(u.id, req.body.contactIds) : undefined; if (req.body.contactIds?.length && !cids!.length) throw badRequest('None of these contacts are yours to allocate');
//   return distribute(u.id, emps, cids, u.id);
// });
// r('get', '/', AC, 'Assignment history', validate({ query: pageQuery.extend({ employeeId: objectId.optional(), status: z.string().optional() }) }), async (req) => {
//   const q = req.q; const f: any = {}; if (req.user!.role === 'COORDINATOR') { const team = await teamOf(req.user!.id); f.employee = { $in: q.employeeId ? team.filter((t: any) => String(t) === q.employeeId) : team }; } else if (q.employeeId) f.employee = oid(q.employeeId); if (q.status) f.status = q.status; const p = paging(q, ['assignedAt'], 'assignedAt');
//   const [items, total] = await Promise.all([Assignment.find(f).populate('contact', 'name phone company status').populate('employee', 'name').populate('assignedBy', 'name').sort(p.sort).skip(p.skip).limit(p.limit).lean(), Assignment.countDocuments(f)]);
//   return pageOf(items, total, p.page, p.limit);
// });
// r('get', '/summary', AC, 'Employee-wise workload', async (req) => {
//   const lead = req.user!.role === 'COORDINATOR' ? req.user!.id : null; const team = lead ? await teamOf(lead) : null;
//   const emps: any[] = await User.find({ role: 'EMPLOYEE', ...(team ? { _id: { $in: team } } : {}) }).select('name status presence').lean();
//   const agg = await Contact.aggregate([{ $match: { assignedTo: team ? { $in: team } : { $ne: null } } }, { $group: { _id: { e: '$assignedTo', s: '$status' }, n: { $sum: 1 } } }]);
//   const items = emps.map((e) => { const mine = agg.filter((a: any) => String(a._id.e) === String(e._id)); const by = (s: string) => mine.filter((m: any) => m._id.s === s).reduce((t: number, m: any) => t + m.n, 0);
//     return { employeeId: e._id, name: e.name, status: e.status, total: mine.reduce((t: number, m: any) => t + m.n, 0), pending: by('ASSIGNED'), inProgress: by('IN_PROGRESS'), followUp: by('FOLLOW_UP'), completed: by('COMPLETED') }; });
//   return { items, unassigned: await Contact.countDocuments({ assignedTo: null, ...(lead ? { createdBy: oid(lead) } : {}) }) };
// });


//---------- 12.11.2026 ------------
// import { Router } from 'express';
// import { z } from 'zod';
// import { Assignment, Contact, User } from '../../models';
// import { api, badRequest, validate } from '../../common/http';
// import { objectId, oid, pageOf, pageQuery, paging } from '../../common/util';
// import { toAdmins, toUser } from '../../common/socket';
// import { notify } from '../notifications/notifications.routes';

// async function apply(employeeId: string, contactIds: string[], by: string) {
//   const ids = contactIds.map(oid); const now = new Date();
//   await Assignment.updateMany({ contact: { $in: ids }, status: 'ACTIVE' }, { status: 'REASSIGNED' });
//   const res = await Contact.updateMany({ _id: { $in: ids }, status: { $ne: 'COMPLETED' } }, [{ $set: { assignedTo: oid(employeeId), assignedAt: now, status: { $cond: [{ $in: ['$status', ['NEW', 'ASSIGNED']] }, 'ASSIGNED', '$status'] } } }]);
//   const done = await Contact.find({ _id: { $in: ids }, assignedTo: oid(employeeId) }).select('_id').lean();
//   if (done.length) await Assignment.insertMany(done.map((c: any) => ({ contact: c._id, employee: oid(employeeId), assignedBy: oid(by), status: 'ACTIVE' })));
//   return { assigned: done.length, skipped: ids.length - done.length, matched: res.matchedCount };
// }
// async function announce(employeeId: string, count: number) {
//   toUser(employeeId, 'assignment.updated', { count }); toAdmins('dashboard.refresh', {});
//   await notify(employeeId, 'New contacts assigned', `${count} contact${count === 1 ? '' : 's'} added to your queue`, 'ASSIGNMENT');
// }
// export async function assign(employeeId: string, contactIds: string[], by: string) {
//   if (!(await User.exists({ _id: employeeId, role: 'EMPLOYEE', status: 'ACTIVE' }))) throw badRequest('Employee not found or inactive');
//   const r = await apply(employeeId, contactIds, by); if (r.assigned) await announce(employeeId, r.assigned); return r;
// }
// /** Equal split across the given (default: all active) employees. */
// export async function distribute(by: string, employeeIds?: string[], contactIds?: string[]) {
//   const emps: any[] = await User.find({ role: 'EMPLOYEE', status: 'ACTIVE', ...(employeeIds?.length ? { _id: { $in: employeeIds.map(oid) } } : {}) }).select('_id').lean();
//   if (!emps.length) throw badRequest('No active employees to distribute to');
//   const ids = contactIds?.length ? contactIds : (await Contact.find({ assignedTo: null, status: { $ne: 'COMPLETED' } }).select('_id').lean()).map((c: any) => String(c._id));
//   if (!ids.length) throw badRequest('No contacts to distribute');
//   const size = Math.ceil(ids.length / emps.length); const out: { employeeId: string; assigned: number }[] = [];
//   for (let i = 0; i < emps.length; i++) {
//     const chunk = ids.slice(i * size, (i + 1) * size); if (!chunk.length) break;
//     const r = await apply(String(emps[i]._id), chunk, by); if (r.assigned) await announce(String(emps[i]._id), r.assigned); out.push({ employeeId: String(emps[i]._id), assigned: r.assigned });
//   }
//   return { total: ids.length, distribution: out };
// }

// const ids = z.array(objectId);
// export const assignmentsRouter = Router(); const r = api(assignmentsRouter, 'assignments', '/assignments'); const A: ['ADMIN'] = ['ADMIN'];
// r('post', '/assign', A, 'Assign / reassign contacts to one employee', validate({ body: z.object({ employeeId: objectId, contactIds: ids.min(1).max(10000) }).strict() }), (req) => assign(req.body.employeeId, req.body.contactIds, req.user!.id));
// r('post', '/distribute', A, 'Distribute contacts equally', validate({ body: z.object({ employeeIds: ids.optional(), contactIds: ids.optional() }).strict() }), (req) => distribute(req.user!.id, req.body.employeeIds, req.body.contactIds));
// r('get', '/', A, 'Assignment history', validate({ query: pageQuery.extend({ employeeId: objectId.optional(), status: z.string().optional() }) }), async (req) => {
//   const q = req.q; const f: any = {}; if (q.employeeId) f.employee = oid(q.employeeId); if (q.status) f.status = q.status; const p = paging(q, ['assignedAt'], 'assignedAt');
//   const [items, total] = await Promise.all([Assignment.find(f).populate('contact', 'name phone company status').populate('employee', 'name').populate('assignedBy', 'name').sort(p.sort).skip(p.skip).limit(p.limit).lean(), Assignment.countDocuments(f)]);
//   return pageOf(items, total, p.page, p.limit);
// });
// r('get', '/summary', A, 'Employee-wise workload', async () => {
//   const emps: any[] = await User.find({ role: 'EMPLOYEE' }).select('name status presence').lean();
//   const agg = await Contact.aggregate([{ $match: { assignedTo: { $ne: null } } }, { $group: { _id: { e: '$assignedTo', s: '$status' }, n: { $sum: 1 } } }]);
//   const items = emps.map((e) => { const mine = agg.filter((a: any) => String(a._id.e) === String(e._id)); const by = (s: string) => mine.filter((m: any) => m._id.s === s).reduce((t: number, m: any) => t + m.n, 0);
//     return { employeeId: e._id, name: e.name, status: e.status, total: mine.reduce((t: number, m: any) => t + m.n, 0), pending: by('ASSIGNED'), inProgress: by('IN_PROGRESS'), followUp: by('FOLLOW_UP'), completed: by('COMPLETED') }; });
//   return { items, unassigned: await Contact.countDocuments({ assignedTo: null }) };
// });

//------ 12.11.2026 ----------
// import { Router } from 'express';
// import { z } from 'zod';
// import { Assignment, Contact, User } from '../../models';
// import { api, badRequest, validate } from '../../common/http';
// import { objectId, oid, pageOf, pageQuery, paging } from '../../common/util';
// import { toAdmins, toUser } from '../../common/socket';
// import { notify } from '../notifications/notifications.routes';

// async function apply(employeeId: string, contactIds: string[], by: string) {
//   const ids = contactIds.map(oid); const now = new Date();
//   await Assignment.updateMany({ contact: { $in: ids }, status: 'ACTIVE' }, { status: 'REASSIGNED' });
//   const res = await Contact.updateMany({ _id: { $in: ids }, status: { $ne: 'COMPLETED' } }, [{ $set: { assignedTo: oid(employeeId), assignedAt: now, status: { $cond: [{ $in: ['$status', ['NEW', 'ASSIGNED']] }, 'ASSIGNED', '$status'] } } }]);
//   const done = await Contact.find({ _id: { $in: ids }, assignedTo: oid(employeeId) }).select('_id').lean();
//   if (done.length) await Assignment.insertMany(done.map((c: any) => ({ contact: c._id, employee: oid(employeeId), assignedBy: oid(by), status: 'ACTIVE' })));
//   return { assigned: done.length, skipped: ids.length - done.length, matched: res.matchedCount };
// }
// async function announce(employeeId: string, count: number) {
//   toUser(employeeId, 'assignment.updated', { count }); toAdmins('dashboard.refresh', {});
//   await notify(employeeId, 'New contacts assigned', `${count} contact${count === 1 ? '' : 's'} added to your queue`, 'ASSIGNMENT');
// }
// export async function assign(employeeId: string, contactIds: string[], by: string) {
//   if (!(await User.exists({ _id: employeeId, role: 'EMPLOYEE', status: 'ACTIVE' }))) throw badRequest('Employee not found or inactive');
//   const r = await apply(employeeId, contactIds, by); if (r.assigned) await announce(employeeId, r.assigned); return r;
// }
// /** Equal split across the given (default: all active) employees. */
// export async function distribute(by: string, employeeIds?: string[], contactIds?: string[]) {
//   const emps: any[] = await User.find({ role: 'EMPLOYEE', status: 'ACTIVE', ...(employeeIds?.length ? { _id: { $in: employeeIds.map(oid) } } : {}) }).select('_id').lean();
//   if (!emps.length) throw badRequest('No active employees to distribute to');
//   const ids = contactIds?.length ? contactIds : (await Contact.find({ assignedTo: null, status: { $ne: 'COMPLETED' } }).select('_id').lean()).map((c: any) => String(c._id));
//   if (!ids.length) throw badRequest('No contacts to distribute');
//   const size = Math.ceil(ids.length / emps.length); const out: { employeeId: string; assigned: number }[] = [];
//   for (let i = 0; i < emps.length; i++) {
//     const chunk = ids.slice(i * size, (i + 1) * size); if (!chunk.length) break;
//     const r = await apply(String(emps[i]._id), chunk, by); if (r.assigned) await announce(String(emps[i]._id), r.assigned); out.push({ employeeId: String(emps[i]._id), assigned: r.assigned });
//   }
//   return { total: ids.length, distribution: out };
// }

// const ids = z.array(objectId);
// export const assignmentsRouter = Router(); const r = api(assignmentsRouter, 'assignments', '/assignments'); const A: ['ADMIN'] = ['ADMIN'];
// r('post', '/assign', A, 'Assign / reassign contacts to one employee', validate({ body: z.object({ employeeId: objectId, contactIds: ids.min(1).max(10000) }).strict() }), (req) => assign(req.body.employeeId, req.body.contactIds, req.user!.id));
// r('post', '/distribute', A, 'Distribute contacts equally', validate({ body: z.object({ employeeIds: ids.optional(), contactIds: ids.optional() }).strict() }), (req) => distribute(req.user!.id, req.body.employeeIds, req.body.contactIds));
// r('get', '/', A, 'Assignment history', validate({ query: pageQuery.extend({ employeeId: objectId.optional(), status: z.string().optional() }) }), async (req) => {
//   const q = req.q; const f: any = {}; if (q.employeeId) f.employee = oid(q.employeeId); if (q.status) f.status = q.status; const p = paging(q, ['assignedAt'], 'assignedAt');
//   const [items, total] = await Promise.all([Assignment.find(f).populate('contact', 'name phone company status').populate('employee', 'name').populate('assignedBy', 'name').sort(p.sort).skip(p.skip).limit(p.limit).lean(), Assignment.countDocuments(f)]);
//   return pageOf(items, total, p.page, p.limit);
// });
// r('get', '/summary', A, 'Employee-wise workload', async () => {
//   const emps: any[] = await User.find({ role: 'EMPLOYEE' }).select('name status presence').lean();
//   const agg = await Contact.aggregate([{ $match: { assignedTo: { $ne: null } } }, { $group: { _id: { e: '$assignedTo', s: '$status' }, n: { $sum: 1 } } }]);
//   const items = emps.map((e) => { const mine = agg.filter((a: any) => String(a._id.e) === String(e._id)); const by = (s: string) => mine.filter((m: any) => m._id.s === s).reduce((t: number, m: any) => t + m.n, 0);
//     return { employeeId: e._id, name: e.name, status: e.status, total: mine.reduce((t: number, m: any) => t + m.n, 0), pending: by('ASSIGNED'), inProgress: by('IN_PROGRESS'), followUp: by('FOLLOW_UP'), completed: by('COMPLETED') }; });
//   return { items, unassigned: await Contact.countDocuments({ assignedTo: null }) };
// });
