import { buildPublicWeb } from './web.ts';
if (!process.env.WEB_ROOT) throw new Error('WEB_ROOT is required');
const app = await buildPublicWeb({
  webRoot: process.env.WEB_ROOT,
  downloadsRoot: process.env.DOWNLOADS_ROOT,
});
await app.listen({
  port: Number(process.env.PORT || 8788),
  host: process.env.HOST || '127.0.0.1',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
