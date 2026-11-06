export const corsOrigin = (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
  if (!origin) return cb(null, true); // curl, mobile apps, server-to-server
  const allowed = (process.env.WEB_URL || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/.test(origin);
  if (allowed.includes(origin) || (process.env.NODE_ENV !== 'production' && isLocal)) return cb(null, true);
  cb(null, false);
};
