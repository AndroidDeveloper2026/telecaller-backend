import { routeDocs } from './http';

/** Builds the OpenAPI 3 document from the route registry, so docs can't drift from the code. */
export function buildOpenApi() {
  const paths: Record<string, any> = {};
  for (const r of routeDocs) {
    const p = r.path.replace(/:(\w+)/g, '{$1}'); const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    (paths[p] ||= {})[r.method] = {
      tags: [r.tag], summary: r.summary + (Array.isArray(r.access) ? ` (${r.access.join('/')} only)` : ''), parameters: params,
      ...(r.access === 'public' ? {} : { security: [{ bearer: [] }] }), responses: { '200': { description: 'OK' }, '400': { description: 'Validation error' }, '401': { description: 'Unauthenticated' }, '403': { description: 'Forbidden' } },
    };
  }
  return { openapi: '3.0.3', info: { title: 'Telecaller Management API', version: '1.0.0' }, components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } }, paths };
}
