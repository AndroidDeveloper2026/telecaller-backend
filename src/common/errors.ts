/** Error types live here (no imports) so http.ts and auth.ts never import each other. */
export class HttpError extends Error {
  constructor(public status: number, public detail: string | string[]) { super(Array.isArray(detail) ? detail.join(', ') : detail); }
}
export const badRequest = (m: string | string[]) => new HttpError(400, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const forbidden = (m = 'Insufficient permissions') => new HttpError(403, m);
export const conflict = (m: string) => new HttpError(409, m);
