import { Router } from 'express';
import { User } from '../../models';
import { api, notFound } from '../../common/http';
import { objectId } from '../../common/util';
import { sanitize } from '../users/users.service';
import { employeeStats } from '../dashboard/dashboard.routes';

const C: ['COORDINATOR'] = ['COORDINATOR'];
export const teamRouter = Router(); const r = api(teamRouter, 'team', '/team');
r('get', '/members', C, 'My team (telecallers reporting to me)', async (req) => {
  const members: any[] = await User.find({ role: 'EMPLOYEE', teamLead: req.user!.id }).sort({ name: 1 }).lean();
  return { items: await Promise.all(members.map(async (m) => ({ ...sanitize(m), presence: m.status === 'ACTIVE' ? m.presence : 'OFFLINE', performance: await employeeStats(String(m._id)) }))) };
});
r('get', '/members/:id', C, 'Team member details with performance', async (req) => {
  const u: any = await User.findOne({ _id: objectId.parse(req.params.id), role: 'EMPLOYEE', teamLead: req.user!.id }).lean(); if (!u) throw notFound('Team member not found');
  return { ...sanitize(u), performance: await employeeStats(String(u._id)) };
});
