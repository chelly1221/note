import { buildApp } from './app.ts';

const required = (key: string) => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
};
if (required('AUTH_MODE') !== 'tailscale')
  throw new Error('The production server requires AUTH_MODE=tailscale.');
const { app } = await buildApp({
  nasRoot: required('NAS_ROOT'),
  stateDir: required('STATE_DIR'),
  storageId: required('NAS_STORAGE_ID'),
  tailscaleLogins: required('TAILSCALE_ALLOWED_LOGINS')
    .split(',')
    .map((login) => login.trim())
    .filter(Boolean),
  requireMount: process.env.REQUIRE_NAS_MOUNT !== 'false',
  secureCookies: process.env.SECURE_COOKIES !== 'false',
  origins: required('APP_ORIGINS')
    .split(',')
    .map((origin) => origin.trim()),
  webRoot: process.env.WEB_ROOT,
  downloadsRoot: process.env.DOWNLOADS_ROOT,
  logger: true,
});
await app.listen({
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
