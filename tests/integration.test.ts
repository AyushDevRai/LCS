import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import Fastify from 'fastify';
import { TelemetryStore } from '../src/services/telemetryStore.js';
import { CrmClient, crmFields, type CrmRecord } from '../src/services/crmClient.js';
import { scoreLead } from '../src/engine/classifier.js';
import { SyncWorker } from '../src/services/syncWorker.js';
import { createApp } from '../src/server.js';
import { loadConfig } from '../src/config.js';
const telemetry = () => ({eventId:randomUUID(),visitorId:randomUUID(),sessionId:randomUUID(),timestamp:new Date().toISOString(),type:'spec_download'});
const emptyFields = Object.fromEntries(Object.keys(crmFields(scoreLead({},{events:[]},loadConfig()))).map(key=>[key,null]));
test('SQLite identity normalization, multi-visitor match, deduplication and restart recovery',() => {
  const directory = mkdtempSync(join(tmpdir(),'lcs-test-')), path = join(directory,'test.sqlite');
  let store = new TelemetryStore(path);
  try {
    const first = {...telemetry(),email:'Lead@Example.com',phone:'+91 98765-43210'};
    assert.equal(store.ingest(first),true); assert.equal(store.ingest(first),false);
    store.ingest({...telemetry(),email:'lead@example.com'});
    assert.equal(store.lookup({email:' LEAD@example.com '}).events.length,2);
    assert.equal(store.lookup({phone:'919876543210'}).events.length,1);
    assert.equal(store.lookup({email:'different@example.com'}).events.length,0);
    store.enqueue('LEAD-1'); store.close(); store = new TelemetryStore(path);
    assert.equal(store.lookup({visitorId:first.visitorId}).events.length,1);
    assert.equal(store.dueJobs()[0]?.id,'LEAD-1');
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});
test('HTTP endpoints enforce auth, origin, payload limits and score linked telemetry',async () => {
  const token = 'a'.repeat(32), app = await createApp({API_TOKEN:token,DATABASE_PATH:':memory:',ALLOWED_ORIGINS:'https://example.com/'});
  try {
    assert.equal((await app.inject({url:'/health'})).statusCode,200);
    const preflight = await app.inject({method:'OPTIONS',url:'/api/track',headers:{origin:'https://example.com','access-control-request-method':'POST'}});
    assert.equal(preflight.statusCode,204);
    assert.equal(preflight.headers['access-control-allow-origin'],'https://example.com');
    assert.equal((await app.inject({method:'POST',url:'/api/score',payload:{}})).statusCode,401);
    const event = {...telemetry(),email:'lead@example.com'};
    assert.equal((await app.inject({method:'POST',url:'/api/track',payload:event,headers:{origin:'https://evil.example'}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/track',payload:{...event,type:'unexpected'},headers:{origin:'https://example.com'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/api/track',payload:event,headers:{origin:'https://example.com'}})).statusCode,202);
    const headers = {authorization:`Bearer ${token}`};
    const result = await app.inject({method:'POST',url:'/api/score',headers,payload:{email:'lead@example.com',organizationType:'school'}});
    assert.equal(result.json().intentScore,10); assert.equal(result.json().fitScore,20);
    assert.equal((await app.inject({method:'POST',url:'/api/score',headers,payload:{inServiceRegion:'false'}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/api/crm-lead-webhook',headers,payload:{lead_id:'1'}})).statusCode,503);
    assert.equal((await app.inject({url:'/tracker/lcs-tracker.js'})).statusCode,200);
    const compressed = await app.inject({url:'/tracker/lcs-tracker.js',headers:{'accept-encoding':'gzip'}});
    assert.equal(compressed.headers['content-encoding'],'gzip');
    assert.ok(compressed.rawPayload.length < 3072);
    assert.match(gunzipSync(compressed.rawPayload).toString(),/window.LCS/);
    assert.equal((await app.inject({url:'/tracker/lcs-tracker.js',headers:{'accept-encoding':'gzip;q=0'}})).headers['content-encoding'],undefined);
    assert.equal((await app.inject({method:'POST',url:'/api/track',headers:{origin:'https://example.com'},payload:{...event,path:'x'.repeat(20000)}})).statusCode,413);
  } finally {await app.close();}
});
test('polling paginates and drains more than 100 queued leads per pass',async () => {
  const store = new TelemetryStore(':memory:'), seen = new Set<string>(), offsets: number[] = [];
  const records = Array.from({length:205},(_,i) => ({name:`LEAD-${i}`}));
  const crm = {
    listLeads:async (offset:number) => {offsets.push(offset);return records.slice(offset,offset+100);},
    getLead:async (id:string) => ({...emptyFields,name:id}), mapLead:(record:CrmRecord) => ({id:record.name}),
    updateLead:async (id:string) => {seen.add(id);}
  } as unknown as CrmClient;
  const worker = new SyncWorker(crm,store,loadConfig(),60000,() => {});
  try {await worker.tick();assert.deepEqual(offsets,[0,100,200]);assert.equal(seen.size,205);assert.equal(store.pendingJobs(),0);}
  finally {await worker.stop();store.close();}
});
test('CRM retries transient failures, maps fields, writes classification and skips unchanged updates',async () => {
  const mock = Fastify(), store = new TelemetryStore(':memory:');
  let getCount = 0, puts = 0;
  const record: CrmRecord = {...emptyFields,name:'LEAD/1',email:'lead@example.com',org:'school',visit:1};
  mock.get('/api/resource/CRM Lead',async () => [ {name:record.name} ]);
  mock.get('/api/resource/CRM Lead/:id',async (req,reply) => {
    assert.equal(req.headers.authorization,'token key:secret');
    if (++getCount === 1) return reply.code(503).send({});
    return {data:record};
  });
  // Frappe wraps list data in the same envelope as resource data.
  mock.addHook('preSerialization',async (_req,_reply,payload) => Array.isArray(payload) ? {data:payload} : payload);
  mock.put('/api/resource/CRM Lead/:id',async req => {puts++;Object.assign(record,req.body);return {data:record};});
  const address = await mock.listen({port:0,host:'127.0.0.1'});
  const client = new CrmClient({url:address,key:'key',secret:'secret',attempts:2,fieldMap:{organizationType:'org',siteVisitRequested:'visit'}});
  const worker = new SyncWorker(client,store,loadConfig(),60000,() => {});
  try {
    await worker.tick();
    assert.equal(puts,1); assert.equal(record.custom_lead_tier,'A1'); assert.equal(record.custom_is_mql,1);
    assert.equal(store.pendingJobs(),0); assert.equal(getCount,2);
    await worker.tick(); assert.equal(puts,1);
  } finally {await worker.stop();store.close();await mock.close();}
});
test('CRM job failures stay durable with backoff; other leads continue',async () => {
  const store = new TelemetryStore(':memory:');
  const crm = {
    listLeads:async () => [{name:'bad'},{name:'good'}],
    getLead:async (id:string) => {if (id === 'bad') throw new Error('CRM HTTP 503');return {...emptyFields,name:id};},
    mapLead:(record:CrmRecord) => ({id:record.name}), updateLead:async () => {}
  } as unknown as CrmClient;
  const worker = new SyncWorker(crm,store,loadConfig(),60000,() => {});
  try {
    await worker.tick(); assert.equal(store.pendingJobs(),1); assert.equal(store.dueJobs().length,0);
    assert.equal(store.dueJobs(Date.now()+10000)[0]?.attempts,1);
  } finally {await worker.stop();store.close();}
});
test('ignored CRM output writes remain failed jobs instead of reporting success',async () => {
  const store = new TelemetryStore(':memory:');let updated = false;
  const crm = {listLeads:async()=>[{name:'missing'}],getLead:async()=>({name:'missing'}),mapLead:()=>({}),updateLead:async()=>{updated=true;throw new Error('CRM did not persist LCS fields; check CRM schema and permissions');}} as unknown as CrmClient;
  const worker = new SyncWorker(crm,store,loadConfig(),60000,()=>{});
  try {await worker.tick();assert.equal(store.pendingJobs(),1);assert.equal(updated,true);assert.match(worker.lastError!,/did not persist LCS fields/);}
  finally {await worker.stop();store.close();}
});
test('fresh CRM leads with omitted null output fields receive their first computed scores',async () => {
  const store = new TelemetryStore(':memory:');let saved:ReturnType<typeof scoreLead>|undefined;
  const crm = {
    listLeads:async()=>[{name:'new'}],
    getLead:async()=>({name:'new',custom_lead_tier:'A1',custom_fit_score:0,custom_intent_score:0,custom_is_mql:0}),
    mapLead:()=>({organizationType:'sports infra contractor',role:'decision maker',courts:2,areaM2:0,inServiceRegion:false,projectType:'new build',setting:'outdoor'}),
    updateLead:async(_id:string,result:ReturnType<typeof scoreLead>)=>{saved=result;}
  } as unknown as CrmClient;
  const worker = new SyncWorker(crm,store,loadConfig(),60000,()=>{});
  try {await worker.tick();assert.equal(saved?.fitScore,25);assert.equal(saved?.intentScore,0);assert.equal(saved?.tier,'B3');assert.equal(store.pendingJobs(),0);assert.equal(worker.lastError,null);}
  finally {await worker.stop();store.close();}
});
test('CRM client rejects success responses that silently omit scoring fields',async () => {
  const mock = Fastify();mock.put('/api/resource/CRM Lead/:id',async()=>({data:{name:'missing'}}));
  const address = await mock.listen({port:0,host:'127.0.0.1'});
  const client = new CrmClient({url:address,key:'key',secret:'secret',attempts:1,fieldMap:{inServiceRegion:'region'}});
  try {
    assert.equal(client.mapLead({name:'1',region:'Unknown'}).inServiceRegion,undefined);
    assert.equal(client.mapLead({name:'1',region:'Inside'}).inServiceRegion,true);
    assert.equal(client.mapLead({name:'1',region:'Outside'}).inServiceRegion,false);
    await assert.rejects(client.updateLead('missing',scoreLead({},{events:[]},loadConfig())),/did not persist LCS fields/);
  } finally {await mock.close();}
});
test('sales form dropdown values produce exact Fit scores with numeric-field compatibility',() => {
  const client = new CrmClient({url:'http://localhost',key:'key',secret:'secret',attempts:1,fieldMap:{organizationType:'org',role:'role',courts:'courts',areaM2:'area',inServiceRegion:'region',projectType:'project',setting:'setting'}});
  const base = {name:'pilot',org:'School',role:'Principal',region:'Inside',project:'New build',setting:'Outdoor',courts:0,area:0};
  const score = (extra:Record<string,unknown>) => scoreLead(client.mapLead({...base,...extra}),{events:[]},loadConfig()).fitScore;
  assert.equal(score({custom_lcs_court_count_band:'3 or more courts',custom_lcs_area_band:'Under 2000 m²'}),50);
  assert.equal(score({custom_lcs_court_count_band:'1 court',custom_lcs_area_band:'Under 2000 m²'}),45);
  assert.equal(score({custom_lcs_court_count_band:'1 court',custom_lcs_area_band:'2000 m² or more'}),50);
  assert.equal(score({custom_lcs_court_count_band:'Not sure',custom_lcs_area_band:'Not sure'}),40);
  assert.equal(score({courts:4,custom_lcs_court_count_band:'Not sure'}),50);
  assert.equal(score({custom_lcs_court_count_band:'2 courts',region:'Outside',setting:'Indoor competition'}),20);
  assert.throws(()=>client.mapLead({...base,custom_lcs_court_count_band:'anything'}),/Invalid CRM project size band/);
});
test('CrmClient supports allowHttp for non-local insecure connections', () => {
  assert.throws(() => new CrmClient({url:'http://crm.example.com',key:'k',secret:'s',attempts:1,fieldMap:{},allowHttp:false}), /Use HTTPS for non-local CRM connections/);
  assert.doesNotThrow(() => new CrmClient({url:'http://crm.example.com',key:'k',secret:'s',attempts:1,fieldMap:{},allowHttp:true}));
});
