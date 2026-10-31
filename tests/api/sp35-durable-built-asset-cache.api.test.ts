import {describe,it,expect} from "vitest";
import {viteCompiledAssetPaths,splitBuiltAsset,assembleBuiltAsset,
 MAX_BUILT_ASSET_BYTES,BUILT_CACHE_CHUNK_BYTES}
 from "../../src/platform/agent/private-built-artifact.js";

describe("Sprint 3.5 durable compiled App assets after sleeping Sandbox",()=>{
 it("selects only local compiled Vite JavaScript/CSS, never remote sources",()=>{
  const html='<script type="module" src="/assets/app-42AB.js"></script>'+
   '<link rel="stylesheet" href="/assets/style-42AB.css">'+
   '<script src="https://evil.example/x.js"></script>';
  expect(viteCompiledAssetPaths(html)).toEqual([
   "index.html","assets/app-42AB.js","assets/style-42AB.css"
  ]);
  expect(()=>viteCompiledAssetPaths("<main>no compiled assets</main>"))
   .toThrow("BUILT_CACHE_SCRIPT_MISSING");
  expect(()=>viteCompiledAssetPaths("x".repeat(300001)))
   .toThrow("BUILT_CACHE_INDEX_INVALID");
 });
 it("round-trips 2 MiB asset in SQLite-safe 64KiB chunks without re-execution",()=>{
  const bytes=new Uint8Array(MAX_BUILT_ASSET_BYTES);
  for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
  const chunks=splitBuiltAsset(bytes);
  expect(chunks.length).toBe(Math.ceil(MAX_BUILT_ASSET_BYTES/BUILT_CACHE_CHUNK_BYTES));
  expect(chunks.every(x=>x.length<=BUILT_CACHE_CHUNK_BYTES)).toBe(true);
  expect(assembleBuiltAsset(chunks)).toEqual(bytes);
 });
 it("fails closed for missing, oversized or manipulated compiled bytes",()=>{
  expect(()=>splitBuiltAsset(new Uint8Array())).toThrow("BUILT_CACHE_ASSET_TOO_LARGE");
  expect(()=>splitBuiltAsset(new Uint8Array(MAX_BUILT_ASSET_BYTES+1)))
   .toThrow("BUILT_CACHE_ASSET_TOO_LARGE");
  expect(()=>assembleBuiltAsset([])).toThrow("BUILT_CACHE_CHUNK_COUNT");
  expect(()=>assembleBuiltAsset([new Uint8Array(2),new Uint8Array(3)]))
   .toThrow("BUILT_CACHE_CHUNKS_INVALID");
 });
});
