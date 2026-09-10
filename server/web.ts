// Public shell only: this process has no NAS mount, app key, or private API.
import Fastify from 'fastify';
import { registerPublicWeb } from './public-web.ts';

export async function buildPublicWeb(config: {
  webRoot: string;
  downloadsRoot?: string;
}) {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );
    if (request.url.split('?')[0].startsWith('/api/'))
      return reply
        .code(404)
        .send({
          code: 'tailscale_only',
          message: '노트 데이터는 Tailscale로만 연결됩니다.',
        });
  });
  await registerPublicWeb(app, config);
  return app;
}
