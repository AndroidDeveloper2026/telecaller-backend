import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { ZodTypeAny } from 'zod';
import { authenticate, requireRole, Role } from './auth';

export class HttpError extends Error {
  constructor(public status: number, public detail: string | string[]) { super(Array.isArray(detail) ? detail.join(', ') : detail); }
}
export const badRequest = (m: string | string[]) => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'Insufficient permissions') => new HttpError(403, m);
export const conflict = (m: string) => new HttpError(409, m);

export const wrap = (fn: (req: Request, res: Response, next: NextFunction) => any): RequestHandler => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const validate = (s: { body?: ZodTypeAny; query?: ZodTypeAny }): RequestHandler => (req, _res, next) => {
  try {
    if (s.body) { const r = s.body.safeParse(req.body ?? {}); if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)); req.body = r.data; }
    if (s.query) { const r = s.query.safeParse(req.query); if (!r.success) throw badRequest(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)); (req as any).q = r.data; }
    next();
  } catch (e) { next(e); }
};

/** Registry feeding the generated OpenAPI/Swagger document. */
export interface RouteDoc { tag: string; method: string; path: string; summary: string; access: 'public' | 'any' | Role[] }
export const routeDocs: RouteDoc[] = [];
type Access = 'public' | 'any' | Role[];

export function api(router: Router, tag: string, base: string) {
  return (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, access: Access, summary: string, ...handlers: RequestHandler[]) => {
    routeDocs.push({ tag, method, path: `/api${base}${path === '/' ? '' : path}`, summary, access });
    const guards: RequestHandler[] = access === 'public' ? [] : [authenticate, ...(Array.isArray(access) ? [requireRole(...access)] : [])];
    // Handlers may simply return a value: it is sent as JSON. POST defaults to 201.
    const send = (h: RequestHandler): RequestHandler => wrap(async (req, res, next) => { if (method === 'post') res.status(201); const r = await (h as any)(req, res, next); if (!res.headersSent && r !== undefined) res.json(r); });
    (router as any)[method](path, ...guards, ...handlers.map(send));
  };
}
