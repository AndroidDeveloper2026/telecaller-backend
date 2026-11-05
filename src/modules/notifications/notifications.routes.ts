import { Router } from 'express';
import { Notification } from '../../models';
import { api } from '../../common/http';
import { toUser } from '../../common/socket';
import { objectId } from '../../common/util';

export async function notify(userId: string, title: string, message?: string, type = 'INFO') {
  const n = await Notification.create({ user: userId, title, message, type }); toUser(userId, 'notification.new', n); return n;
}
export const notificationsRouter = Router(); const r = api(notificationsRouter, 'notifications', '/notifications');
r('get', '/', 'any', 'List my notifications', async (req) => {
  const items = await Notification.find({ user: req.user!.id, ...(req.query.unread === 'true' ? { read: false } : {}) }).sort({ createdAt: -1 }).limit(50).lean();
  return { items, unread: items.filter((i: any) => !i.read).length };
});
r('patch', '/read-all', 'any', 'Mark all read', async (req) => { await Notification.updateMany({ user: req.user!.id, read: false }, { read: true }); return { ok: true }; });
r('patch', '/:id/read', 'any', 'Mark one read', async (req) => { objectId.parse(req.params.id); await Notification.updateOne({ _id: req.params.id, user: req.user!.id }, { read: true }); return { ok: true }; });
