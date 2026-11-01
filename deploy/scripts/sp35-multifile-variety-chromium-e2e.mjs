/**
 * Three distinct trusted hand-authored source trees in the SAME GPT-6 v2
 * multi-file contract, compiled by real Vite and clicked in real Chromium.
 * This does NOT use a model or certify arbitrary AI Apps, backend auth,
 * production or general UX speed; it catches a broken shared file pipeline.
 */
import {build} from "vite";
import {chromium} from "@playwright/test";
import {mkdtemp,mkdir,writeFile,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import http from "node:http";
import {parseAiProjectFiles} from "../../dist/src/edge/free-ai-project-files.js";

const cases=[
 {name:"task-list",button:"新增任務",expected:"任務：1",
  module:"src/features/tasks.ts",
  helper:"export const next=(v:number)=>v+1;",
  main:"import './style.css';import {next} from './features/tasks';const a=document.querySelector('#app');let n=0;const b=document.createElement('button');b.textContent='新增任務';const p=document.createElement('p');p.id='result';p.textContent='任務：0';b.onclick=()=>{p.textContent='任務：'+next(n++);};a?.append(b,p);"},
 {name:"calculator",button:"計算結果",expected:"結果：7",
  module:"src/features/math.ts",
  helper:"export const add=(a:number,b:number)=>a+b;",
  main:"import './style.css';import {add} from './features/math';const a=document.querySelector('#app');const b=document.createElement('button');b.textContent='計算結果';const p=document.createElement('p');p.id='result';p.textContent='結果：0';b.onclick=()=>{p.textContent='結果：'+add(3,4);};a?.append(b,p);"},
 {name:"habit-tracker",button:"完成打卡",expected:"連續：1",
  module:"src/domain/habit/streak.ts",
  helper:"export const nextDay=(n:number)=>n+1;",
  main:"import './style.css';import {nextDay} from './domain/habit/streak';const a=document.querySelector('#app');const b=document.createElement('button');b.textContent='完成打卡';const p=document.createElement('p');p.id='result';let n=0;p.textContent='連續：0';b.onclick=()=>{n=nextDay(n);p.textContent='連續：'+n;};a?.append(b,p);"}
];
const browser=await chromium.launch({headless:true});
const timings=[];
try{
 for(const c of cases){
  const files=parseAiProjectFiles({files:[
   {path:"src/main.ts",content:c.main},
   {path:"src/style.css",content:"body { font-family: system-ui; margin: 12px; }"},
   {path:c.module,content:c.helper}
  ]});
  if(!files||files.length!==3)throw Error("MULTIFILE_MODEL_CONTRACT_REJECTED_"+c.name);
  const root=await mkdtemp(path.join(tmpdir(),"appf2-sp35-variety-"));
  let server;
  try{
   await writeFile(path.join(root,"index.html"),
    '<!doctype html><html><body><main id="app"></main><script type="module" src="/src/main.ts"></script></body></html>');
   for(const f of files){
    const full=path.join(root,f.path);
    await mkdir(path.dirname(full),{recursive:true});
    await writeFile(full,f.content);
   }
   const started=Date.now();
   await build({root,configFile:false,logLevel:"error",
    build:{outDir:"dist",emptyOutDir:true}});
   server=http.createServer(async(req,res)=>{
    const p=new URL(req.url??"/","http://127.0.0.1").pathname;
    if(!/^\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)?$/u.test(p)){
     res.writeHead(404);res.end();return;
    }
    try{
     const file=path.join(root,"dist",p==="/index.html"||p==="/"?
      "index.html":p.slice(1));
     const bytes=await readFile(file);
     res.writeHead(200,{"Content-Type":file.endsWith(".js")?
      "text/javascript":file.endsWith(".css")?"text/css":"text/html"});
     res.end(bytes);
    }catch{res.writeHead(404);res.end();}
   });
   await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
   const page=await browser.newPage();
   try{
    const origin="http://127.0.0.1:"+server.address().port;
    await page.route("**/*",route=>route.request().url().startsWith(origin+"/")?
     route.continue():route.abort());
    const errors=[];
    page.on("pageerror",e=>errors.push(String(e)));
    await page.goto(origin,{waitUntil:"load",timeout:16000});
    await page.getByRole("button",{name:c.button,exact:true}).click();
    const actual=await page.locator("#result").innerText();
    if(actual!==c.expected||errors.length)
     throw Error("MULTIFILE_BROWSER_FEATURE_FAILED_"+c.name);
    timings.push({name:c.name,observed_total_ms:Date.now()-started});
    console.log("SP35 V2 MULTI-MODULE REAL VITE/CHROMIUM PASS: "+c.name);
   }finally{await page.close();}
  }finally{
   if(server)await new Promise(resolve=>server.close(resolve));
   await rm(root,{recursive:true,force:true});
  }
 }
 console.log("SP35 MULTI-MODULE FIXTURE TIMINGS (not paid model or SLA): "+
  JSON.stringify(timings));
}finally{await browser.close();}
