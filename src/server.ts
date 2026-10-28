import 'dotenv/config';
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { loadConfig } from './config.js';
import { TelemetryStore } from './services/telemetryStore.js';
import { CrmClient } from './services/crmClient.js';
import { SyncWorker } from './services/syncWorker.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { webhookRoutes } from './routes/webhook.js';
export async function createApp(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig();
  if (!env.API_TOKEN || env.API_TOKEN.length < 24) throw new Error('Set API_TOKEN to at least 24 characters (npm run setup generates one)');
  const app = Fastify({logger:{redact:['req.headers.authorization','req.body']},bodyLimit:16384});
  const origins = (env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(',').map(v => v.trim().replace(/\/+$/, '')).filter(Boolean);
  if (origins.includes('*')) throw new Error('ALLOWED_ORIGINS must contain exact origins');
  await app.register(cors,{origin:origins, methods:['POST','GET']});
  await app.register(rateLimit,{max:120,timeWindow:'1 minute'});
  const store = new TelemetryStore(env.DATABASE_PATH ?? './data/lcs.sqlite');
  let worker: SyncWorker | undefined;
  if (env.CRM_URL) {
    if (!env.CRM_API_KEY || !env.CRM_API_SECRET) throw new Error('CRM API credentials are required');
    const interval = Number(env.CRM_POLL_INTERVAL_MS ?? 60000), attempts = Number(env.CRM_RETRY_ATTEMPTS ?? 4);
    if (!Number.isInteger(interval) || interval < 1000 || !Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error('Invalid CRM polling interval or retry attempts');
    const fieldMap: unknown = JSON.parse(env.CRM_FIELD_MAP ?? '{}');
    if (!fieldMap || typeof fieldMap !== 'object' || Array.isArray(fieldMap) || Object.values(fieldMap).some(v => typeof v !== 'string')) throw new Error('CRM_FIELD_MAP must be a JSON string-to-string map');
    const allowHttp = env.CRM_ALLOW_HTTP === 'true' || env.ALLOW_INSECURE_HTTP === 'true';
    worker = new SyncWorker(new CrmClient({url:env.CRM_URL,key:env.CRM_API_KEY,secret:env.CRM_API_SECRET,attempts,fieldMap:fieldMap as Record<string,string>,allowHttp}),store,config,interval,message => app.log.warn(message));
  }
  const token = Buffer.from(`Bearer ${env.API_TOKEN}`);
  const auth: import('fastify').preHandlerHookHandler = async (request,reply) => {
    const supplied = Buffer.from(request.headers.authorization ?? '');
    if (supplied.length !== token.length || !timingSafeEqual(supplied,token)) return reply.code(401).send({error:'Unauthorized'});
  };
  telemetryRoutes(app,store,origins);
  webhookRoutes(app,store,config,auth,worker);
  app.get('/',async () => ({status:'ok',service:'lead-classification-system'}));
  app.get('/health',async () => ({status:'ok',crmConfigured:!!worker,crmUrl:env.CRM_URL ?? null,nodeVersion:process.version}));
  app.get('/api/status',{preHandler:auth},async () => ({pendingJobs:store.pendingJobs(),lastSync:worker?.lastSuccess ?? null,lastError:worker?.lastError ?? null}));
  app.post('/api/sync-now',{preHandler:auth},async (request,reply) => {
    if (!worker) return reply.code(503).send({error:'CRM not configured'});
    await worker.tick();
    return reply.send({lastSuccess:worker.lastSuccess,lastError:worker.lastError,pendingJobs:store.pendingJobs()});
  });
  const tracker = readFileSync(new URL('../tracker/lcs-tracker.js',import.meta.url));
  const compressedTracker = gzipSync(tracker);
  app.get('/tracker/lcs-tracker.js',async (request,reply) => {
    reply.type('application/javascript').header('Cache-Control','public, max-age=300').header('Vary','Accept-Encoding');
    const gzip = (request.headers['accept-encoding'] ?? '').split(',').some(value => {
      const match = /^\s*gzip\s*(?:;\s*q=([\d.]+))?\s*$/i.exec(value);
      return !!match && (match[1] === undefined || Number(match[1]) > 0);
    });
    return gzip ? reply.header('Content-Encoding','gzip').send(compressedTracker) : reply.send(tracker);
  });
  app.addHook('onReady',async () => {worker?.start();});
  app.addHook('onClose',async () => {await worker?.stop();store.close();});
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createApp();
  for (const signal of ['SIGTERM','SIGINT'] as const) process.once(signal,() => {void app.close();});
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.RENDER ? '0.0.0.0' : (process.env.HOST && process.env.HOST !== '127.0.0.1' ? process.env.HOST : (process.env.NODE_ENV === 'production' ? '0.0.0.0' : (process.env.HOST ?? '0.0.0.0')));
  const address = await app.listen({port, host});
  console.log(`LCS server listening on ${address}`);
}
