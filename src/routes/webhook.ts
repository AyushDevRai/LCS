import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { leadSchema } from '../validation.js';
import { scoreLead } from '../engine/classifier.js';
import type { TelemetryStore } from '../services/telemetryStore.js';
import type { SyncWorker } from '../services/syncWorker.js';
const webhookSchema = z.object({lead_id:z.string().trim().min(1).max(300)}).strict();
export function webhookRoutes(app: FastifyInstance, store: TelemetryStore, config: Config, auth: preHandlerHookHandler, worker?: SyncWorker) {
  app.post('/api/score',{preHandler:auth},async (request,reply) => {
    const parsed = leadSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({error:'Invalid lead fields'});
    return scoreLead(parsed.data,store.lookup(parsed.data),config);
  });
  app.post('/api/crm-lead-webhook',{preHandler:auth},async (request,reply) => {
    if (!worker) return reply.code(503).send({error:'CRM is not configured'});
    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({error:'Expected {lead_id: "CRM lead name"}'});
    store.enqueue(parsed.data.lead_id);
    // Persist before acknowledgement. Worker fetches canonical CRM lead data.
    void worker.tick();
    return reply.code(202).send({queued:true});
  });
}
