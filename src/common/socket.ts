import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { authUserFromToken } from './auth';
import { corsOrigin } from './cors';

let io: Server | null = null;
export function initSocket(http: HttpServer) {
  io = new Server(http, { cors: { origin: corsOrigin, credentials: true } });
  io.on('connection', async (client) => {
    try {
      const token = (client.handshake.auth?.token as string) || String(client.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const u = await authUserFromToken(token);
      client.join(`user:${u.id}`); if (u.role === 'ADMIN') client.join('admins');
    } catch { client.emit('auth_error', 'unauthorized'); client.disconnect(true); }
  });
  return io;
}
export const toUser = (id: string, event: string, data: any) => io?.to(`user:${id}`).emit(event, data);
export const toAdmins = (event: string, data: any) => io?.to('admins').emit(event, data);