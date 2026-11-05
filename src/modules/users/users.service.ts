import bcrypt from 'bcryptjs';
import { User } from '../../models';
import { conflict } from '../../common/http';
import { esc, pageOf, paging } from '../../common/util';

export const hash = (pw: string) => bcrypt.hash(pw, 12);
export const sanitize = (u: any) => { const o = u?.toObject ? u.toObject() : { ...u }; delete o.passwordHash; delete o.refreshTokenHash; return o; };

export async function createUser(d: { name: string; email: string; password: string; phone?: string; role?: string }) {
  if (await User.exists({ email: d.email.toLowerCase() })) throw conflict('Email already in use');
  return sanitize(await User.create({ name: d.name, email: d.email, phone: d.phone, role: d.role || 'EMPLOYEE', passwordHash: await hash(d.password) }));
}
export async function listUsers(q: any, role = 'EMPLOYEE') {
  const f: any = { role };
  if (q.status) f.status = q.status; if (q.presence) f.presence = q.presence;
  if (q.search) { const r = new RegExp(esc(q.search), 'i'); f.$or = [{ name: r }, { email: r }, { phone: r }]; }
  const p = paging(q, ['name', 'email', 'createdAt', 'status']);
  const [items, total] = await Promise.all([User.find(f).sort(p.sort).skip(p.skip).limit(p.limit).lean(), User.countDocuments(f)]);
  return pageOf(items, total, p.page, p.limit);
}
export async function seedAdmin() {
  if (await User.exists({ role: 'ADMIN' })) return;
  const email = process.env.SEED_ADMIN_EMAIL, password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return console.warn('[warn] No admin exists and SEED_ADMIN_* not set');
  await createUser({ name: process.env.SEED_ADMIN_NAME || 'Admin', email, password, role: 'ADMIN' }); console.log(`Seeded admin ${email}`);
}
