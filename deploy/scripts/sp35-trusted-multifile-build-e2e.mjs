/**
 * Trusted committed test fixture only. Never receives AI code, input or commands.
 * Actual Vite TS dependency compilation + independent Chromium click.
 */
import {build} from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {chromium} from "@playwright/test";
const root=path.resolve("tests/fixtures/sp35-multifile");
const destination=await fs.mkdtemp(path.join(os.tmpdir(),"appf2-sp35-multifile-"));
let server,browser;
try{
 await build({root,configFile:false,logLevel:"error",build:{
  outDir:destination,emptyOutDir:true,minify:false
 }});
 const html=await fs.readFile(path.join(destination,"index.html"),"utf8");
 const assets=await fs.readdir(path.join(destination,"assets"));
 if(!html.includes("/assets/")||!assets.some(x=>x.endsWith(".js")))
  throw Error("MULTIFILE_COMPILER_FAILED");
 server=http.createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url??"/","http://127.0.0.1").pathname);
  if(!/^\/(?:index\.html|assets\/[a-zA-Z0-9_.-]+)?$/u.test(pathname)){
   res.writeHead(404);res.end();return;
  }
  const file=pathname==="/"?path.join(destination,"index.html"):
   path.join(destination,pathname.slice(1));
  try{
   const body=await fs.readFile(file);
   res.writeHead(200,{"Content-Type":file.endsWith(".js")?
    "text/javascript":"text/html","X-Content-Type-Options":"nosniff"});
   res.end(body);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=server.address().port;
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.goto("http://127.0.0.1:"+port+"/",{waitUntil:"load"});
 await page.getByRole("button",{name:"Add"}).click();
 const actual=await page.locator("#result").textContent();
 if(actual!=="APPF2_MULTIFILE_COMPILED_42")throw Error("MULTIFILE_BROWSER_ASSERTION_FAILED:"+actual);
 console.log("SP35 TRUSTED MULTI-FILE VITE BUILD + CHROMIUM INTERACTION: PASS (NO AI, NO CLOUD SANDBOX)");
}finally{
 if(browser)await browser.close();
 if(server)await new Promise(resolve=>server.close(resolve));
 await fs.rm(destination,{recursive:true,force:true});
}
