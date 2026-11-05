import { Router } from 'express';
import { CallLog, Contact, User } from '../../models';
import { api } from '../../common/http';
import { TZ, dayStr, oid } from '../../common/util';
import { getDispositions } from '../settings/settings.routes';

const day = { $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone: TZ() } };
const successKeys = async () => (await getDispositions()).filter((d) => d.success).map((d) => d.key);
const rate = (s: number, t: number) => (t ? Math.round((s / t) * 100) : 0);
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => dayStr(new Date(Date.now() - (n - 1 - i) * 86400000)));

export async function adminStats(range: 'today' | 'all' = 'today') {
  const today = dayStr(); const sk = await successKeys(); const since = new Date(Date.now() - 200 * 86400000);
  const [totalEmployees, activeEmployees, totalContacts, assignedContacts, pendingContacts, completedContacts] = await Promise.all([
    User.countDocuments({ role: 'EMPLOYEE' }), User.countDocuments({ role: 'EMPLOYEE', status: 'ACTIVE' }), Contact.countDocuments(), Contact.countDocuments({ assignedTo: { $ne: null } }),
    Contact.countDocuments({ assignedTo: { $ne: null }, callCount: 0 }), Contact.countDocuments({ status: 'COMPLETED' }),
  ]);
  const month = { $dateToString: { format: '%Y-%m', date: '$startTime', timezone: TZ() } };
  const ok = { $sum: { $cond: [{ $in: ['$disposition', sk] }, 1, 0] } };
  const [agg] = await CallLog.aggregate([{ $addFields: { day, month } }, { $facet: {
    totals: [{ $group: { _id: null, total: { $sum: 1 }, connected: { $sum: { $cond: [{ $eq: ['$callStatus', 'CONNECTED'] }, 1, 0] } }, avg: { $avg: '$duration' }, success: ok } }],
    today: [{ $match: { day: today } }, { $count: 'n' }], dispositions: [{ $group: { _id: '$disposition', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
    daily: [{ $match: { startTime: { $gte: new Date(Date.now() - 16 * 86400000) } } }, { $group: { _id: '$day', calls: { $sum: 1 }, success: ok } }],
    monthly: [{ $match: { startTime: { $gte: since } } }, { $group: { _id: '$month', calls: { $sum: 1 } } }, { $sort: { _id: 1 } }],
    perEmp: [{ $match: range === 'today' ? { day: today } : {} }, { $group: { _id: '$employee', calls: { $sum: 1 }, success: ok, contacts: { $addToSet: '$contact' } } }],
  } }]);
  const t = agg.totals[0] || { total: 0, connected: 0, avg: 0, success: 0 }; const dm = new Map<string, any>(agg.daily.map((d: any) => [d._id, d]));
  const emps = await User.find({ role: 'EMPLOYEE' }).select('name status presence').sort({ name: 1 }).lean();
  const as = await Contact.aggregate([{ $match: { assignedTo: { $ne: null } } }, { $group: { _id: '$assignedTo', assigned: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ['$callCount', 0] }, 1, 0] } } } }]);
  const am = new Map<string, any>(as.map((a: any) => [String(a._id), a])); const pm = new Map<string, any>(agg.perEmp.map((p: any) => [String(p._id), p]));
  const performance = emps.map((e: any) => {
    const a = am.get(String(e._id)) || { assigned: 0, pending: 0 }; const p = pm.get(String(e._id)) || { calls: 0, success: 0, contacts: [] };
    return { employeeId: e._id, name: e.name, status: e.status, presence: e.status === 'ACTIVE' ? e.presence : 'OFFLINE', assigned: a.assigned, called: p.contacts.length, pending: a.pending, calls: p.calls, successRate: rate(p.success, p.calls) };
  });
  return {
    cards: { totalEmployees, activeEmployees, totalContacts, assignedContacts, pendingContacts, completedContacts, totalCalls: t.total, completedCalls: t.connected, todayCalls: agg.today[0]?.n || 0, avgDuration: Math.round(t.avg || 0), successRate: rate(t.success, t.total) },
    dispositions: agg.dispositions.map((d: any) => ({ key: d._id, count: d.count })),
    daily: lastDays(14).map((d) => ({ date: d, calls: dm.get(d)?.calls || 0, success: dm.get(d)?.success || 0 })),
    monthly: agg.monthly.map((m: any) => ({ month: m._id, calls: m.calls })).slice(-6), performance, range,
  };
}

export async function employeeStats(id: string) {
  const e = oid(id); const today = dayStr(); const sk = await successKeys();
  const [assigned, pending, followUps, completed] = await Promise.all([
    Contact.countDocuments({ assignedTo: e }), Contact.countDocuments({ assignedTo: e, callCount: 0 }), Contact.countDocuments({ assignedTo: e, status: 'FOLLOW_UP' }), Contact.countDocuments({ assignedTo: e, status: 'COMPLETED' }),
  ]);
  const [agg] = await CallLog.aggregate([{ $match: { employee: e } }, { $addFields: { day } }, { $facet: {
    totals: [{ $group: { _id: null, total: { $sum: 1 }, avg: { $avg: '$duration' }, success: { $sum: { $cond: [{ $in: ['$disposition', sk] }, 1, 0] } } } }],
    today: [{ $match: { day: today } }, { $group: { _id: null, calls: { $sum: 1 }, talk: { $sum: '$duration' } } }], dispositions: [{ $group: { _id: '$disposition', count: { $sum: 1 } } }],
    daily: [{ $match: { startTime: { $gte: new Date(Date.now() - 9 * 86400000) } } }, { $group: { _id: '$day', calls: { $sum: 1 }, talk: { $sum: '$duration' } } }],
  } }]);
  const t = agg.totals[0] || { total: 0, avg: 0, success: 0 }; const td = agg.today[0] || { calls: 0, talk: 0 }; const dm = new Map<string, any>(agg.daily.map((d: any) => [d._id, d]));
  return {
    assigned, pending, followUps, completed, totalCalls: t.total, avgDuration: Math.round(t.avg || 0), successRate: rate(t.success, t.total), callsToday: td.calls, talkTimeToday: td.talk,
    dispositions: agg.dispositions.map((d: any) => ({ key: d._id, count: d.count })), daily: lastDays(7).map((d) => ({ date: d, calls: dm.get(d)?.calls || 0, talk: dm.get(d)?.talk || 0 })),
  };
}
export const dashboardRouter = Router(); const r = api(dashboardRouter, 'dashboard', '/dashboard');
r('get', '/admin', ['ADMIN'], 'Admin dashboard statistics', (req) => adminStats(req.query.range === 'all' ? 'all' : 'today'));
r('get', '/employee', ['EMPLOYEE'], 'Employee dashboard statistics', (req) => employeeStats(req.user!.id));
