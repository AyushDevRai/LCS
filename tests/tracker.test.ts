import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
const source = readFileSync(new URL('../tracker/lcs-tracker.js',import.meta.url),'utf8');
function browser(options: {consent?:string; dnt?:string; blockedStorage?:boolean;path?:string} = {}) {
  const calls: any[] = [], handlers: Record<string,Function> = {}, values = new Map<string,string>();
  const document = {
    currentScript:{src:'https://lcs.example.com/tracker/lcs-tracker.js',dataset:{consent:options.consent}},
    cookie:'',referrer:'',body:{dataset:{}},querySelectorAll:()=>frames,addEventListener:(name:string,fn:Function) => {handlers[name] = fn;}
  };
  const frameWindow = {}, frames = [{contentWindow:frameWindow,getAttribute:()=> 'https://crm.example.com/crm-form/sales?embed=1'}];
  const window: any = {addEventListener:(name:string,fn:Function) => {handlers[name] = fn;}};
  const location = {href:'https://example.com/pricing?utm_source=google&utm_medium=cpc&utm_term=court+cost',pathname:'/pricing',search:'?utm_source=google&utm_medium=cpc&utm_term=court+cost',protocol:'https:'};
  if (options.path) {location.pathname=options.path;location.href='https://example.com'+options.path;location.search='';}
  window.history = {pushState:(_state:unknown,_unused:string,url:string)=>{location.pathname=url;},replaceState:(_state:unknown,_unused:string,url:string)=>{location.pathname=url;}};
  const storage = {getItem:(k:string) => {if(options.blockedStorage) throw new Error();return values.get(k);},setItem:(k:string,v:string) => {if(options.blockedStorage) throw new Error();values.set(k,v);}};
  runInNewContext(source,{window,document,location,navigator:{doNotTrack:options.dnt},crypto:{randomUUID},localStorage:storage,URL,URLSearchParams,Date,
    fetch:(_url:string,options:any) => {calls.push(JSON.parse(options.body));return Promise.resolve();}, FormData:class {constructor(private form:any){} get(key:string){return this.form.fields[key];}}});
  return {window,document,calls,handlers,values,frameWindow};
}
test('tracker captures attribution, clean URLs and stable UUIDs',() => {
  const b = browser();
  assert.equal(b.calls.length,1);assert.equal(b.calls[0].pageTier,'pricing');
  assert.equal(b.calls[0].referrer,'');assert.equal(b.calls[0].landingPage,'https://example.com/pricing');
  assert.equal(b.calls[0].utm.utm_term,'court cost');assert.match(b.document.cookie,/Secure/);
  b.window.LCS.identify({email:'lead@example.com'});
  assert.equal(b.calls[1].visitorId,b.calls[0].visitorId);assert.equal(b.calls[1].sessionId,b.calls[0].sessionId);
  assert.notEqual(b.calls[0].eventId,b.calls[1].eventId);
});
test('CRM iframe submission links visitor history and supplies contact-page intent',()=>{
  const b=browser();b.handlers.message!({source:b.frameWindow,origin:'https://crm.example.com',data:{type:'crm:form-submitted',documentType:'CRM Lead',identity:{email:'lead@example.com',phone:'+919876543210'}}});
  assert.equal(b.calls.length,3);assert.equal(b.calls[1].type,'identify');assert.equal(b.calls[1].email,'lead@example.com');
  assert.equal(b.calls[2].pageTier,'contact');assert.equal(b.calls[2].visitorId,b.calls[0].visitorId);
});
test('iframe bridge ignores unrelated origins, windows, invalid identities and disabled consent',()=>{
  const b=browser(), message={source:b.frameWindow,origin:'https://crm.example.com',data:{type:'crm:form-submitted',documentType:'CRM Lead',identity:{email:'lead@example.com'}}};
  b.handlers.message!({...message,origin:'https://evil.example'});b.handlers.message!({...message,source:{}});
  b.handlers.message!({...message,data:{...message.data,documentType:'CRM Deal'}});
  b.handlers.message!({...message,data:{...message.data,identity:{email:'bad'}}});
  b.window.LCS.consent(false);b.handlers.message!(message);assert.equal(b.calls.length,1);
});
test('product pages, project gallery and detail pages use evaluation categories',()=>{
  assert.equal(browser({path:'/badminton'}).calls[0].pageTier,'systems');
  assert.equal(browser({path:'/hockey'}).calls[0].pageTier,'systems');
  assert.equal(browser({path:'/our-projects'}).calls[0].pageTier,'systems');
  assert.equal(browser({path:'/our-projects/school'}).calls[0].pageTier,'case_study');
});
test('SPA pushState and replaceState navigations emit new page events',()=>{
  const b=browser();b.window.history.pushState({},'','/hockey');b.window.history.replaceState({},'','/our-projects');
  assert.equal(b.calls.length,3);assert.equal(b.calls[1].path,'/hockey');assert.equal(b.calls[2].pageTier,'systems');
});
test('tracker honors consent and Do Not Track',() => {
  const b = browser({consent:'required'});
  assert.equal(b.calls.length,0);assert.equal(b.document.cookie,'');assert.equal(b.values.size,0);
  b.window.LCS.consent(true);assert.equal(b.calls.length,1);
  b.window.LCS.consent(false);b.window.LCS.track('calculator_used');assert.equal(b.calls.length,1);
  assert.equal(browser({dnt:'1'}).window.LCS,undefined);
});
test('tracker rotates sessions after inactivity and tolerates blocked storage',() => {
  const b = browser();const original = b.calls[0];
  b.values.set('lcs_last',String(Date.now()-31*60000));
  b.window.LCS.page();assert.notEqual(b.calls[1].sessionId,original.sessionId);assert.equal(b.calls[1].visitorId,original.visitorId);
  const blocked = browser({blockedStorage:true});blocked.window.LCS.page();
  assert.equal(blocked.calls.length,2);assert.equal(blocked.calls[0].sessionId,blocked.calls[1].sessionId);
});
test('tracker links form submissions and emits request and RFQ evidence without file contents',() => {
  const b = browser();
  const form = {fields:{email:'lead@example.com',phone:'+919876543210'},dataset:{lcsForm:'site_visit'},
    querySelector:() => ({}),querySelectorAll:() => [{files:[{name:'private-tender.pdf'}]}]};
  b.handlers.submit!({target:form});
  assert.deepEqual(b.calls.slice(1).map(e => e.type),['identify','site_visit_requested','rfq_shared']);
  assert.equal(b.calls[1].email,'lead@example.com');assert.equal(JSON.stringify(b.calls).includes('private-tender.pdf'),false);
});
test('tracker requires actual played duration above 50 percent',() => {
  const b = browser();let end = 40;
  const video = {tagName:'VIDEO',hasAttribute:() => true,duration:100,played:{length:1,start:() => 0,end:() => end}};
  b.handlers.timeupdate!({target:video});assert.equal(b.calls.length,1);
  end = 51;b.handlers.timeupdate!({target:video});b.handlers.timeupdate!({target:video});
  assert.equal(b.calls.length,2);assert.equal(b.calls[1].type,'video_watched');
});
