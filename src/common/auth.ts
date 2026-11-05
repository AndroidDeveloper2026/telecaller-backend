import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models';
import { HttpError } from './http';

export type Role = 'ADMIN' | 'EMPLOYEE';
export interface AuthUser { id: string; role: Role; name: string; email: string }
declare global { namespace Express { interface Request { user?: AuthUser; q?: any } } }

export const secrets = () => ({ access: process.env.JWT_SECRET as string, refresh: process.env.JWT_REFRESH_SECRET as string });

/** Verifies the bearer token AND re-checks the account in the DB, so deactivation takes effect immediately. */
export async function authUserFromToken(token: string): Promise<AuthUser> {
  let payload: any;
  try { payload = jwt.verify(token, secrets().access); } catch { throw new HttpError(401, 'Invalid or expired token'); }
  const u: any = await User.findById(payload.sub).lean();
  if (!u || u.status !== 'ACTIVE') throw new HttpError(401, 'Account inactive');
  return { id: String(u._id), role: u.role, name: u.name, email: u.email };
}
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Missing token');
    req.user = await authUserFromToken(token); next();
  } catch (e) { next(e); }
}
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => (req.user && roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Insufficient permissions')));
