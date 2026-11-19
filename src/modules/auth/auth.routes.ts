import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { User, PRESENCE } from '../../models';
import { api, badRequest, validate, HttpError } from '../../common/http';
import { secrets } from '../../common/auth';
import { toAdmins, toLead } from '../../common/socket';
import { hash, sanitize } from '../users/users.service';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const GRACE_MS = 5 * 60 * 1000; // an already-rotated refresh token stays usable briefly (lost response / parallel tabs)
const MAX_SESSIONS = 20;
/** Issues a token pair. Each refresh gives a fresh refresh token (sliding expiry); every device keeps its own session. */
async function issue(u: any, rotateFrom?: string) {
  const payload = { sub: String(u._id), role: u.role }; const s = secrets();
  const accessToken = jwt.sign(payload, s.access, { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any, jwtid: randomUUID() });
  const refreshToken = jwt.sign(payload, s.refresh, { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '90d') as any, jwtid: randomUUID() });
  const h = sha(refreshToken); const now = Date.now();
  const rotated = rotateFrom && (await User.updateOne({ _id: u._id, 'refreshSessions.h': rotateFrom }, { $set: { 'refreshSessions.$.h': h, 'refreshSessions.$.prev': rotateFrom, 'refreshSessions.$.prevAt': now } })).matchedCount;
  if (!rotated) await User.updateOne({ _id: u._id }, { $push: { refreshSessions: { $each: [{ h, at: now }], $slice: -MAX_SESSIONS } } });
  return { accessToken, refreshToken };
}
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false, message: { statusCode: 429, message: 'Too many login attempts. Try again later.', error: 'Too Many Requests' } });

export const authRouter = Router(); const r = api(authRouter, 'auth', '/auth');
r('post', '/login', 'public', 'Login', loginLimit, validate({ body: z.object({ email: z.string().email(), password: z.string().min(1) }).strict() }), async (req) => {
  const u = await User.findOne({ email: req.body.email.toLowerCase() }).select('+passwordHash');
  if (!u || !(await bcrypt.compare(req.body.password, u.passwordHash))) throw new HttpError(401, 'Invalid email or password');
  if (u.status !== 'ACTIVE') throw new HttpError(401, 'Account is deactivated');
  if (u.role === 'EMPLOYEE') { u.presence = 'AVAILABLE'; await u.save(); toAdmins('presence.updated', { employeeId: String(u._id), presence: 'AVAILABLE' }); toLead(String(u._id), 'presence.updated', { employeeId: String(u._id), presence: 'AVAILABLE' }); }
  return { ...(await issue(u)), user: sanitize(u) };
});
r('post', '/refresh', 'public', 'Rotate tokens', validate({ body: z.object({ refreshToken: z.string() }).strict() }), async (req) => {
  let p: any; try { p = jwt.verify(req.body.refreshToken, secrets().refresh); } catch { throw new HttpError(401, 'Invalid refresh token'); }
  const u: any = await User.findById(p.sub).select('+refreshSessions +refreshTokenHash');
  if (!u || u.status !== 'ACTIVE') throw new HttpError(401, 'Invalid refresh token');
  const h = sha(req.body.refreshToken); const list: any[] = u.refreshSessions || [];
  const cur = list.find((x) => x.h === h);
  const recent = list.find((x) => x.prev === h && Date.now() - (x.prevAt || 0) < GRACE_MS);
  if (!cur && !recent && u.refreshTokenHash !== h) throw new HttpError(401, 'Invalid refresh token');
  return issue(u, cur ? h : undefined);
});
r('post', '/logout', 'any', 'Logout (revokes refresh token)', async (req) => {
  const id = req.user!.id; const emp = req.user!.role === 'EMPLOYEE';
  const rt = typeof req.body?.refreshToken === 'string' ? sha(req.body.refreshToken) : null; // this device only, when sent
  await User.updateOne({ _id: id }, { ...(rt ? { $pull: { refreshSessions: { $or: [{ h: rt }, { prev: rt }] } } } : { $unset: { refreshTokenHash: 1, refreshSessions: 1 } }), ...(emp ? { presence: 'OFFLINE' } : {}) });
  if (emp) { toAdmins('presence.updated', { employeeId: id, presence: 'OFFLINE' }); toLead(id, 'presence.updated', { employeeId: id, presence: 'OFFLINE' }); }
  return { ok: true };
});
r('get', '/me', 'any', 'Current user', async (req) => sanitize(await User.findById(req.user!.id).lean()));
r('patch', '/me', 'any', 'Update own profile', validate({ body: z.object({ name: z.string().min(2).optional(), phone: z.string().optional() }).strict() }), async (req) => sanitize(await User.findByIdAndUpdate(req.user!.id, req.body, { new: true }).lean()));
r('post', '/change-password', 'any', 'Change own password', validate({ body: z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(72) }).strict() }), async (req) => {
  const u: any = await User.findById(req.user!.id).select('+passwordHash');
  if (!(await bcrypt.compare(req.body.currentPassword, u.passwordHash))) throw badRequest('Current password is incorrect');
  u.passwordHash = await hash(req.body.newPassword); u.refreshTokenHash = undefined; u.refreshSessions = []; await u.save(); return { ok: true };
});
r('patch', '/presence', ['EMPLOYEE'], 'Set presence', validate({ body: z.object({ presence: z.enum(PRESENCE as [string, ...string[]]) }).strict() }), async (req) => {
  await User.updateOne({ _id: req.user!.id }, { presence: req.body.presence }); toAdmins('presence.updated', { employeeId: req.user!.id, presence: req.body.presence }); toLead(req.user!.id, 'presence.updated', { employeeId: req.user!.id, presence: req.body.presence }); return { presence: req.body.presence };
});


//--------- 19-11-2026 -------------
// import { Router } from 'express';
// import bcrypt from 'bcryptjs';
// import jwt from 'jsonwebtoken';
// import rateLimit from 'express-rate-limit';
// import { createHash, randomUUID } from 'crypto';
// import { z } from 'zod';
// import { User, PRESENCE } from '../../models';
// import { api, badRequest, validate, HttpError } from '../../common/http';
// import { secrets } from '../../common/auth';
// import { toAdmins, toLead } from '../../common/socket';
// import { hash, sanitize } from '../users/users.service';

// const sha = (s: string) => createHash('sha256').update(s).digest('hex');
// async function issue(u: any) {
//   const payload = { sub: String(u._id), role: u.role }; const s = secrets();
//   const accessToken = jwt.sign(payload, s.access, { expiresIn: (process.env.JWT_EXPIRES_IN || '15m') as any, jwtid: randomUUID() });
//   const refreshToken = jwt.sign(payload, s.refresh, { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any, jwtid: randomUUID() });
//   await User.updateOne({ _id: u._id }, { refreshTokenHash: sha(refreshToken) });
//   return { accessToken, refreshToken };
// }
// const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 50, standardHeaders: true, legacyHeaders: false, message: { statusCode: 429, message: 'Too many login attempts. Try again later.', error: 'Too Many Requests' } });

// export const authRouter = Router(); const r = api(authRouter, 'auth', '/auth');
// r('post', '/login', 'public', 'Login', loginLimit, validate({ body: z.object({ email: z.string().email(), password: z.string().min(1) }).strict() }), async (req) => {
//   const u = await User.findOne({ email: req.body.email.toLowerCase() }).select('+passwordHash');
//   if (!u || !(await bcrypt.compare(req.body.password, u.passwordHash))) throw new HttpError(401, 'Invalid email or password');
//   if (u.status !== 'ACTIVE') throw new HttpError(401, 'Account is deactivated');
//   if (u.role === 'EMPLOYEE') { u.presence = 'AVAILABLE'; await u.save(); toAdmins('presence.updated', { employeeId: String(u._id), presence: 'AVAILABLE' }); toLead(String(u._id), 'presence.updated', { employeeId: String(u._id), presence: 'AVAILABLE' }); }
//   return { ...(await issue(u)), user: sanitize(u) };
// });
// r('post', '/refresh', 'public', 'Rotate tokens', validate({ body: z.object({ refreshToken: z.string() }).strict() }), async (req) => {
//   let p: any; try { p = jwt.verify(req.body.refreshToken, secrets().refresh); } catch { throw new HttpError(401, 'Invalid refresh token'); }
//   const u: any = await User.findById(p.sub).select('+refreshTokenHash');
//   if (!u || u.status !== 'ACTIVE' || u.refreshTokenHash !== sha(req.body.refreshToken)) throw new HttpError(401, 'Invalid refresh token');
//   return issue(u);
// });
// r('post', '/logout', 'any', 'Logout (revokes refresh token)', async (req) => {
//   const id = req.user!.id; const emp = req.user!.role === 'EMPLOYEE';
//   await User.updateOne({ _id: id }, { $unset: { refreshTokenHash: 1 }, ...(emp ? { presence: 'OFFLINE' } : {}) });
//   if (emp) { toAdmins('presence.updated', { employeeId: id, presence: 'OFFLINE' }); toLead(id, 'presence.updated', { employeeId: id, presence: 'OFFLINE' }); }
//   return { ok: true };
// });
// r('get', '/me', 'any', 'Current user', async (req) => sanitize(await User.findById(req.user!.id).lean()));
// r('patch', '/me', 'any', 'Update own profile', validate({ body: z.object({ name: z.string().min(2).optional(), phone: z.string().optional() }).strict() }), async (req) => sanitize(await User.findByIdAndUpdate(req.user!.id, req.body, { new: true }).lean()));
// r('post', '/change-password', 'any', 'Change own password', validate({ body: z.object({ currentPassword: z.string(), newPassword: z.string().min(8).max(72) }).strict() }), async (req) => {
//   const u: any = await User.findById(req.user!.id).select('+passwordHash');
//   if (!(await bcrypt.compare(req.body.currentPassword, u.passwordHash))) throw badRequest('Current password is incorrect');
//   u.passwordHash = await hash(req.body.newPassword); u.refreshTokenHash = undefined; await u.save(); return { ok: true };
// });
// r('patch', '/presence', ['EMPLOYEE'], 'Set presence', validate({ body: z.object({ presence: z.enum(PRESENCE as [string, ...string[]]) }).strict() }), async (req) => {
//   await User.updateOne({ _id: req.user!.id }, { presence: req.body.presence }); toAdmins('presence.updated', { employeeId: req.user!.id, presence: req.body.presence }); toLead(req.user!.id, 'presence.updated', { employeeId: req.user!.id, presence: req.body.presence }); return { presence: req.body.presence };
// });
