// import 'dotenv/config';
// import http from 'http';
// import mongoose from 'mongoose';
// import { createApp } from './app';
// import { initSocket } from './common/socket';
// import { seedAdmin } from './modules/users/users.service';

// async function bootstrap() {
//   for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
//     const v = process.env[k];
//     if (!v || v.startsWith('replace_with')) { if (process.env.NODE_ENV === 'production') throw new Error(`${k} must be set to a secure value`); console.warn(`[warn] ${k} is not set to a secure value`); }
//   }
//   await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/telecaller_system');
//   await seedAdmin();
//   const server = http.createServer(createApp()); initSocket(server);
//   const port = Number(process.env.PORT) || 3000;
//   server.listen(port, '0.0.0.0', () => console.log(`API: http://localhost:${port}/api  |  Docs: http://localhost:${port}/api/docs`));
//   const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0))); process.on('SIGTERM', stop); process.on('SIGINT', stop);
// }
// bootstrap().catch((e) => { console.error(e); process.exit(1); });

import 'dotenv/config';
import dns from 'node:dns';
import http from 'http';
import mongoose from 'mongoose';
import { createApp } from './app';
import { initSocket } from './common/socket';
import { seedAdmin } from './modules/users/users.service';

// Force Node.js to use public DNS resolvers.
// Fixes: querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
// Must run before mongoose.connect() triggers the SRV lookup.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

async function bootstrap() {
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const v = process.env[k];
    if (!v || v.startsWith('replace_with')) {
      if (process.env.NODE_ENV === 'production') throw new Error(`${k} must be set to a secure value`);
      console.warn(`[warn] ${k} is not set to a secure value`);
    }
  }

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/telecaller_system');
  await seedAdmin();

  const server = http.createServer(createApp());
  initSocket(server);

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () =>
    console.log(`API: http://localhost:${port}/api  |  Docs: http://localhost:${port}/api/docs`)
  );

  const stop = () =>
    server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});