/**
 * SP35 FREE trusted-fixture feasibility gate. NOT a model-created App or product PASS.
 * Tests real existing immutable workspace edit/CAS logic, actual independent Chromium
 * criteria for five cumulative changes, one rejected regression, and re-open.
 * No AI, remote DB, Cloudflare, deployment, or paid Sandbox.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from '@playwright/test';
import {createProjectSnapshot,applyProjectEdits,verifyProjectSnapshot}
 from '../../dist/src/platform/agent/project-workspace.js';
import {runBuiltAppQa} from './sp35-built-app-independent-qa.mjs';

const spec=(id,prompt,steps,assertions)=>({
 id,prompt,plan:{version:'1',criteria:[{
  id,source_quote:prompt,description:prompt,automatable:true,steps,assertions
 }]}
});
const click=name=>({action:'click',role:'button',name});
const specs=[
 spec('increment','按新增讓計數增加一',
  [click('新增')],[{kind:'text_appears',text:'計數：1'}]),
 spec('decrement','增加兩次後按減少，計數變成一',
  [click('新增'),click('新增'),click('減少')],
  [{kind:'text_appears',text:'計數：1'}]),
 spec('reset','計數增加後能重設並顯示已重設',
  [click('新增'),click('重設')],[{kind:'text_appears',text:'已重設'}]),
 spec('step','選擇步長二再按新增，計數增加二',
  [{action:'select',role:'combobox',name:'步長',value:'2'},click('新增')],
  [{kind:'text_appears',text:'計數：2'}]),
 spec('persist','按新增之後重新整理仍顯示計數一',
  [click('新增'),{action:'reload'}],[{kind:'text_appears',text:'計數：1'}]),
 spec('dark','按切換深色後顯示深色模式已開',
  [click('切換深色')],[{kind:'text_appears',text:'深色模式：開'}])
];
const html=(flags={},broken=false)=>`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>SP35 受控修改測試</title></head><body>
<h1>受控修改測試</h1><output id="counter">計數：0</output><button type="button" id="add">新增</button>
${flags.decrement?'<button type="button" id="subtract">減少</button>':''}
${flags.reset?'<button type="button" id="reset">重設</button><output id="reset-status"></output>':''}
${flags.step?'<label for="step">步長</label><select id="step"><option value="1">一</option><option value="2">二</option></select>':''}
${flags.dark?'<button type="button" id="dark">切換深色</button><output id="dark-status">深色模式：關</output>':''}
<script>
'use strict';
const persist=${Boolean(flags.persist)};
let count=persist?Number(localStorage.getItem('sp35-safe-count')||0):0;
const output=document.getElementById('counter');
function render(){output.textContent='計數：'+count;if(persist)localStorage.setItem('sp35-safe-count',String(count));}
render();
${broken?'/* deliberately rejected edit: add handler missing */':`document.getElementById('add').addEventListener('click',()=>{count+=Number(document.getElementById('step')?.value||1);render();});`}
${flags.decrement?`document.getElementById('subtract').addEventListener('click',()=>{count--;render();});`:''}
${flags.reset?`document.getElementById('reset').addEventListener('click',()=>{count=0;render();document.getElementById('reset-status').textContent='已重設';});`:''}
${flags.dark?`document.getElementById('dark').addEventListener('click',()=>{document.getElementById('dark-status').textContent='深色模式：開';document.body.dataset.theme='dark';});`:''}
</script></body></html>`;

let served='';
const server=http.createServer((req,res)=>{
 if(req.method!=='GET'||new URL(req.url??'/','http://127.0.0.1').pathname!=='/'){
  res.writeHead(404);res.end();return;
 }
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
 res.end(served);
});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const addr=server.address();
 if(!addr||typeof addr==='string')throw Error('NO_LOOPBACK_LISTENER');
 const origin='http://127.0.0.1:'+addr.port;
 browser=await chromium.launch({headless:true});
 const content=snapshot=>snapshot.files.find(f=>f.path==='index.html')?.content;
 const ledger=new Map();
 const keep=async snapshot=>{assert(await verifyProjectSnapshot(snapshot));ledger.set(snapshot.project_hash,snapshot);};
 const accept=async (candidate,required)=>{
  assert.equal(await verifyProjectSnapshot(candidate),true);
  served=content(candidate);
  const outcomes=[];
  for(const s of required){
   const checks=await runBuiltAppQa({browser,origin,plan:s.plan,prompt:s.prompt});
   outcomes.push({id:s.id,verdict:checks[0]?.verdict});
  }
  return outcomes;
 };
 let active=await createProjectSnapshot('VITE_WEB','index.html',[{path:'index.html',content:html()}]);
 await keep(active);
 assert((await accept(active,specs.slice(0,1))).every(x=>x.verdict==='PASS'));
 const initial=active;
 const flags={};
 const changes=['decrement','reset','step','persist','dark'];
 let observed=1;
 for(let i=0;i<changes.length;i++){
  flags[changes[i]]=true;
  const prior=active.files.find(f=>f.path==='index.html');
  const candidate=await applyProjectEdits(active,active.project_hash,[{
   operation:'replace',path:'index.html',previous_hash:prior.hash,content:html(flags)
  }]);
  assert.equal(candidate.parent_hash,active.project_hash);
  const checks=await accept(candidate,specs.slice(0,i+2));
  assert(checks.every(x=>x.verdict==='PASS'),
   'REJECTED_VALID_EDIT_'+changes[i]+' '+JSON.stringify(checks));
  await keep(candidate);
  active=candidate;
  observed+=checks.length;
  console.log('SP35 FREE SAFE EDIT '+(i+1)+'/5 PASS '+changes[i]+' cumulative_checks='+checks.length);
 }
 assert.equal(active.revision,6);
 assert.equal(ledger.size,6);
 assert.equal((await verifyProjectSnapshot(initial)),true);
 assert.equal(content(ledger.get(initial.project_hash)),html());
 // Intentional destructive edit. New candidate gets a full old+new QA suite,
 // MUST FAIL, and MUST NOT replace the accepted head.
 const oldHead=active.project_hash;
 const bad=await applyProjectEdits(active,active.project_hash,[{
  operation:'replace',path:'index.html',
  previous_hash:active.files[0].hash,content:html(flags,true)
 }]);
 const negative=await accept(bad,specs);
 assert(negative.some(x=>x.verdict==='FAIL'), 'DESTRUCTIVE_EDIT_FALSE_PASS');
 assert.equal(active.project_hash,oldHead);
 assert.equal(ledger.has(bad.project_hash),false);
 assert.equal(await verifyProjectSnapshot(active),true);
 await assert.rejects(applyProjectEdits(active,initial.project_hash,[{
  operation:'replace',path:'index.html',previous_hash:active.files[0].hash,content:html(flags)
 }]),/PROJECT_STALE_REVISION/);
 console.log('SP35 FREE DESTRUCTIVE EDIT: REJECTED; accepted V6 hash unchanged');
 // Reopen accepted version with a new browser page in the same user context:
 // *local* persistence, not server-side Postgres proof.
 served=content(active);
 const context=await browser.newContext({serviceWorkers:'block'});
 try{
  const page=await context.newPage();
  await page.goto(origin+'/');
  await page.getByRole('button',{name:'新增'}).click();
  assert.equal(await page.locator('#counter').innerText(),'計數：1');
  await page.close();
  const reopened=await context.newPage();
  await reopened.goto(origin+'/');
  assert.equal(await reopened.locator('#counter').innerText(),'計數：1');
  await reopened.close();
 }finally{await context.close();}
 // Reopen older immutable V1 without rerunning AI; its original requirement remains true.
 assert((await accept(initial,specs.slice(0,1))).every(x=>x.verdict==='PASS'));
 console.log('SP35 FIVE-EDIT FREE FOUNDATION: PASS 5 cumulative versions + regression rejection + local reopen + preserved V1; no AI, paid cloud or DB; NOT LIVE PRODUCT E2E');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
