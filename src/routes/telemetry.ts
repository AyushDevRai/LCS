import type { FastifyInstance } from 'fastify';
import { eventSchema } from '../validation.js';
import type { TelemetryStore } from '../services/telemetryStore.js';
export function telemetryRoutes(app: FastifyInstance, store: TelemetryStore, origins: string[]) {
  app.post('/api/track', async (request,reply) => {
    const origin = request.headers.origin;
    if (!origin || !origins.includes(origin)) return reply.code(403).send({error:'Website origin is not allowed'});
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({error:'Invalid telemetry event'});
    const inserted = store.ingest(parsed.data);
    return reply.code(202).send({accepted:true, duplicate:!inserted});
  });
}
