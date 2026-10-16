import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { calculateFit } from '../src/engine/fitCalculator.js';
import { calculateIntent } from '../src/engine/intentCalculator.js';
import { resolveMatrix, scoreLead } from '../src/engine/classifier.js';
import type { TelemetryEvent } from '../src/types.js';
const config = loadConfig(), now = new Date('2026-10-15T00:00:00Z');
const event = (values: Partial<TelemetryEvent> = {}): TelemetryEvent => ({eventId:randomUUID(),visitorId:randomUUID(),sessionId:'session-one',timestamp:now.toISOString(),type:'page_view',...values});
for (const [fit, band] of [[0,'C'],[24,'C'],[25,'B'],[34,'B'],[35,'A'],[50,'A']] as const) {
  for (const [intent, level] of [[0,3],[19,3],[20,2],[34,2],[35,1],[50,1]] as const) {
    test(`matrix fit=${fit}, intent=${intent} -> ${band}${level}`,() => assert.equal(resolveMatrix(fit,intent,config),`${band}${level}`));
  }
}
test('fit component totals, caps and missing values',() => {
  assert.equal(calculateFit({organizationType:'School',role:'principal',courts:3,inServiceRegion:true,projectType:'new_build'},config).score,50);
  assert.equal(calculateFit({organizationType:'hotel',role:'coach',courts:1,inServiceRegion:true,projectType:'repair'},config).score,31);
  assert.equal(calculateFit({},config).score,0);
  assert.equal(calculateFit({organizationType:'homeowner',inServiceRegion:false},config).score,0);
  assert.equal(calculateFit({organizationType:'sports club',areaM2:2000},config).score,30);
  assert.equal(calculateFit({organizationType:'sports club',areaM2:1999,courts:2},config).score,25);
  assert.equal(calculateFit({organizationType:'sports club',courts:3,setting:'indoor_competition'},config).score,25);
  assert.equal(calculateFit({setting:'indoor_competition'},config).reviewRequired,true);
});
test('all organization tiers and roles',() => {
  for (const [tier,aliases] of Object.entries(config.organizations)) {
    if (tier === 'roles') continue;
    for (const alias of aliases as string[]) assert.equal(calculateFit({organizationType:alias},config).organizationTier,tier);
  }
  assert.equal(calculateFit({role:'decision_maker'},config).score,10);
  assert.equal(calculateFit({role:'facility manager'},config).score,6);
});
test('deepest page counted once; repeat actions do not inflate intent',() => {
  const events = [event({pageTier:'quote'}),event({pageTier:'blog'}),event({type:'spec_download'}),event({type:'spec_download'})];
  assert.equal(calculateIntent({}, {events},config,now).score,35);
  assert.equal(calculateIntent({}, {events:[event({type:'whatsapp_click'})]},config,now).score,25);
  assert.equal(calculateIntent({}, {events:[event({type:'quote_requested'})]},config,now).score,25);
});
test('behavioral bonuses count distinct case studies and sessions',() => {
  const events = [event({pageTier:'case_study',path:'/cases/a'}),event({type:'case_study_viewed',path:'/cases/a'}),event({type:'calculator_used'})];
  assert.equal(calculateIntent({}, {events},config,now).score,22);
  events.push(event({type:'case_study_viewed',path:'/cases/b'}));
  assert.equal(calculateIntent({}, {events},config,now).score,30);
  events.push(event({sessionId:'session-two'}));
  assert.equal(calculateIntent({}, {events},config,now).score,38);
});
test('return window includes exactly seven days and excludes longer gaps',() => {
  const age = (days:number) => new Date(now.getTime()-days*86400000).toISOString();
  for (const [days,expected] of [[7,18],[7.001,10]] as const) {
    assert.equal(calculateIntent({}, {events:[event({timestamp:age(days)}),event({pageTier:'specs',sessionId:'two'})]},config,now).score,expected);
  }
});
test('channel search weighting, rounding, caps and negative scores',() => {
  const session = {events:[event({pageTier:'quote'})]};
  assert.equal(calculateIntent({channel:'paid_search',query:'court cost'},session,config,now).score,38);
  assert.equal(calculateIntent({channel:'organic_search',query:'court dimensions'},session,config,now).score,20);
  assert.equal(calculateIntent({channel:'direct'},session,config,now).score,33);
  assert.equal(calculateIntent({channel:'facebook'},session,config,now).score,18);
  assert.equal(calculateIntent({channel:'direct'},{events:[...session.events,event({type:'calculator_used'}),event({type:'spec_download'})]},config,now).score,50);
  assert.equal(calculateIntent({},{events:[event({pageTier:'careers'})]},config,now).score,0);
  assert.equal(calculateIntent({},{events:[event({pageTier:'quote'}),event({type:'careers_viewed'})]},config,now).score,15);
  assert.equal(calculateIntent({},{events:[event({pageTier:'specs',utm:{utm_source:'google',utm_medium:'cpc',utm_term:'contractor'}})]},config,now).score,15);
});
test('decay uses complete 30-day periods',() => {
  for (const [days,expected] of [[29.999,25],[30,19],[59.999,19],[60,14]] as const) {
    assert.equal(calculateIntent({},{events:[event({pageTier:'quote',timestamp:new Date(now.getTime()-days*86400000).toISOString()})]},config,now).score,expected);
  }
});
test('future or malformed events ignored and IDs deduplicated',() => {
  const download = event({type:'spec_download'});
  assert.equal(calculateIntent({},{events:[download,download,event({timestamp:'bad',type:'calculator_used'}),event({timestamp:'2027-01-01T00:00:00Z',pageTier:'quote'})]},config,now).score,10);
});
test('fast tracks promote classification without altering numeric scores',() => {
  for (const lead of [{siteVisitRequested:true},{rfqShared:true},{organizationType:'school',quoteRequested:true}]) {
    const result = scoreLead(lead,{events:[]},config,now);
    assert.equal(result.tier,'A1'); assert.equal(result.isMql,true); assert.ok(result.fastTrack.length);
  }
  assert.equal(scoreLead({organizationType:'hotel',quoteRequested:true},{events:[]},config,now).tier,'C2');
  assert.equal(scoreLead({},{events:[event({type:'rfq_shared'})]},config,now).tier,'A1');
  assert.notEqual(scoreLead({},{events:[event({pageTier:'site_visit'})]},config,now).tier,'A1');
});
test('partner and disqualified precede fast tracks',() => {
  for (const [org,tier] of [['dealer','Partner'],['student','Disqualified']] as const) {
    const result = scoreLead({organizationType:org,siteVisitRequested:true},{events:[]},config,now);
    assert.equal(result.tier,tier); assert.equal(result.isMql,false); assert.deepEqual(result.fastTrack,[]);
  }
});
test('configuration changes drive points, bands and fast track switches',() => {
  const changed = structuredClone(config);
  changed.rules.fit.roles.decision_maker = 22;
  changed.rules.bands.fitB = 20;
  changed.rules.fastTracks.siteVisit = false;
  const result = scoreLead({role:'owner',siteVisitRequested:true},{events:[]},changed,now);
  assert.equal(result.fitScore,22); assert.equal(result.tier,'B2');
});
