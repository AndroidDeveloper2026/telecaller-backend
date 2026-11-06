import 'dotenv/config';
import dns from 'node:dns';
import http from 'http';
import mongoose from 'mongoose';
import { createApp } from './app';
import { initSocket } from './common/socket';
import { seedAdmin } from './modules/users/users.service';

// Public DNS resolvers: fixes `querySrv ECONNREFUSED` for mongodb+srv (Atlas) URIs.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

async function connectDb() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/telecaller_system';
  for (;;) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
      console.log('MongoDB connected');
      await seedAdmin();
      return;
    } catch (e: any) {
      console.error(`[db] connection failed: ${e?.message}. Retrying in 5s...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function bootstrap() {
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const v = process.env[k];
    if (!v || v.startsWith('replace_with')) {
      if (process.env.NODE_ENV === 'production') throw new Error(`${k} must be set to a secure value`);
      console.warn(`[warn] ${k} is not set to a secure value`);
    }
  }

  const server = http.createServer(createApp());
  initSocket(server);

  const port = Number(process.env.PORT) || 3000;
  server.on('error', (e: any) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other process or change PORT.` : e);
    process.exit(1);
  });
  // Listen first so the API is reachable even while the database is still connecting.
  server.listen(port, '0.0.0.0', () =>
    console.log(`API: http://localhost:${port}/api  |  Docs: http://localhost:${port}/api/docs`)
  );

  connectDb();

  const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
