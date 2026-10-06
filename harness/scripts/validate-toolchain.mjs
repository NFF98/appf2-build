import fs from "node:fs";

const errors=[];
const toolchain=JSON.parse(fs.readFileSync("tooling/TOOLCHAIN.json","utf8"));
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8"));
const current=JSON.parse(fs.readFileSync("build-spec/CURRENT.json","utf8"));
const ci=JSON.parse(fs.readFileSync("ci/policy.json","utf8"));

for(const [name,version] of Object.entries(toolchain.packages||{})){
  if(pkg.devDependencies?.[name]!==version) errors.push("Toolchain version mismatch "+name+": expected "+version+", got "+(pkg.devDependencies?.[name]||"MISSING"));
}
const web=toolchain.web_runtime||{};
for(const [name,version] of Object.entries(web.runtime_packages||{})){
  if(pkg.dependencies?.[name]!==version) errors.push("Web runtime version mismatch "+name+": expected "+version+", got "+(pkg.dependencies?.[name]||"MISSING"));
}
for(const [name,version] of Object.entries(web.dev_packages||{})){
  if(pkg.devDependencies?.[name]!==version) errors.push("Web dev tool version mismatch "+name+": expected "+version+", got "+(pkg.devDependencies?.[name]||"MISSING"));
}
const lockRoot=lock.packages?.[""]||{};
for(const [name,version] of Object.entries(web.runtime_packages||{})){
  if(lockRoot.dependencies?.[name]!==version) errors.push("Lock root runtime mismatch "+name);
  if(lock.packages?.["node_modules/"+name]?.version!==version) errors.push("Lock package version mismatch "+name);
}
for(const [name,version] of Object.entries(web.dev_packages||{})){
  if(lockRoot.devDependencies?.[name]!==version) errors.push("Lock root dev mismatch "+name);
  if(lock.packages?.["node_modules/"+name]?.version!==version) errors.push("Lock package version mismatch "+name);
}

const scripts=[
  "check:types","check:lint","test:unit","test:contract","test:regression",
  "test:e2e","test:a11y","test:responsive","test:visual","security:audit","build",
  "gate:test-integrity","gate:engineering-quality","product:ci","product:release-ci",
  web.build_script,web.preview_script,web.playwright_server_script
].filter(Boolean);
for(const name of scripts) if(!pkg.scripts?.[name]) errors.push("Missing toolchain script: "+name);

for(const file of ["tsconfig.json","tsconfig.build.json","eslint.config.mjs","vitest.config.ts","playwright.config.ts","tooling/web/vite.config.ts",".github/workflows/codeql.yml",".github/dependabot.yml"]){
  if(!fs.existsSync(file)) errors.push("Missing toolchain config: "+file);
}
const playwright=fs.readFileSync("playwright.config.ts","utf8");
if(!playwright.includes('command: "npm run web:test-server"')) errors.push("Playwright must start the canonical Product web server");
if(!playwright.includes('url: "http://127.0.0.1:4173"')) errors.push("Playwright Product web server URL mismatch");

const holdExceptions=new Set(JSON.parse(fs.readFileSync("harness/policy/repo-policy.json","utf8")).hold_exceptions||[]);
const hasRealImplementation=()=>{
  const roots=["src","tests","generated","supabase"];
  const walk=dir=>{
    if(!fs.existsSync(dir)) return false;
    for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
      const p=dir+"/"+ent.name;
      if(ent.isDirectory()){ if(walk(p)) return true; }
      else if(!holdExceptions.has(p)) return true;
    }
    return false;
  };
  return roots.some(walk);
};
if(current.implementation_enabled && ci.lockfile_required_when_implementation_enabled && !fs.existsSync("package-lock.json") && hasRealImplementation()){
  errors.push("Real implementation exists without package-lock.json");
}
if(pkg.devDependencies?.typescript?.startsWith("7.")){
  errors.push("TypeScript 7 is not approved while current typescript-eslint support is <6.1.0");
}
if(errors.length){
  console.error("TOOLCHAIN GATE: FAIL");
  errors.forEach(e=>console.error("- "+e));
  process.exit(1);
}
console.log("TOOLCHAIN GATE: PASS");
