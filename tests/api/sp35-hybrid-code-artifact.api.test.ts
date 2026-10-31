import {describe,expect,it} from "vitest";
import {
 makePrototypeCodeArtifact,verifyPrototypeCodeArtifact,canonicalArtifactJson,
 CODE_ARTIFACT_SCHEMA,CODE_ARTIFACT_PROFILE
} from "../../src/platform/blueprint/code-artifact-v2.js";

const example='document.getElementById("app").textContent="hello";';
describe("H1 strict Blueprint v2 CodeArtifact integrity (no AI, no R2, not v1 F02)",()=>{
 it("permits arbitrary general JS bytes pinned to immutable manifest and envelope",async()=>{
  const pkg=await makePrototypeCodeArtifact("十八啦",example);
  const result=await verifyPrototypeCodeArtifact(pkg);
  expect(result.ok).toBe(true);
  if(result.ok){
   expect(result.blueprint_hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
   expect(result.artifact.envelope.schema_version).toBe(CODE_ARTIFACT_SCHEMA);
   expect(result.artifact.envelope.execution.sandbox_profile).toBe(CODE_ARTIFACT_PROFILE);
  }
  expect((await verifyPrototypeCodeArtifact(structuredClone(pkg))).ok).toBe(true);
  expect(canonicalArtifactJson({b:1,a:2})).toBe('{"a":2,"b":1}');
 });
 it("rejects tampering with code bytes or manifest content even when metadata hash stays same",async()=>{
  const pkg=await makePrototypeCodeArtifact("code",example);
  const tampered={...pkg,javascript:pkg.javascript.replace("hello","jello")};
  expect(await verifyPrototypeCodeArtifact(tampered)).toMatchObject({ok:false,reason:"HASH_MISMATCH"});
  const wrongManifest={...pkg,manifest:{...pkg.manifest,files:[{...pkg.manifest.files[0],hash:"sha256:"+"0".repeat(64)}]}};
  expect(await verifyPrototypeCodeArtifact(wrongManifest)).toMatchObject({ok:false,reason:"HASH_MISMATCH"});
  const wrongPackage={...pkg,envelope:{...pkg.envelope,execution:{
    ...pkg.envelope.execution,artifact_id:"sha256:"+"0".repeat(64)
  }}};
  expect(await verifyPrototypeCodeArtifact(wrongPackage)).toMatchObject({ok:false,reason:"HASH_MISMATCH"});
 });
 it("fails closed on unknown fields, arbitrary paths, permission escalation, unsupported v1 claims",async()=>{
  const pkg=await makePrototypeCodeArtifact("code",example);
  const extras={...pkg,envelope:{...pkg.envelope,evil_token:"steal"}};
  expect((await verifyPrototypeCodeArtifact(extras)).ok).toBe(false);
  const wrongPath={...pkg,manifest:{...pkg.manifest,files:[{...pkg.manifest.files[0],path:"../app.js"}]}};
  expect((await verifyPrototypeCodeArtifact(wrongPath)).ok).toBe(false);
  const privilege={...pkg,manifest:{...pkg.manifest,permission_profile:"UNLIMITED_NETWORK"}};
  expect((await verifyPrototypeCodeArtifact(privilege)).ok).toBe(false);
  const legacy={...pkg,envelope:{...pkg.envelope,schema_version:"1.0.0"}};
  expect((await verifyPrototypeCodeArtifact(legacy)).ok).toBe(false);
  expect((await verifyPrototypeCodeArtifact({javascript:example})).ok).toBe(false);
 });
 it("rejects oversized, script-tag escape and empty source before creating an artifact",async()=>{
  await expect(makePrototypeCodeArtifact("x","")).rejects.toThrow("CODE_ARTIFACT_INVALID_SOURCE");
  await expect(makePrototypeCodeArtifact("x","x".repeat(128*1024+1))).rejects.toThrow("CODE_ARTIFACT_INVALID_SOURCE");
  await expect(makePrototypeCodeArtifact("x",'console.log("evil")</script>')).rejects.toThrow("CODE_ARTIFACT_INVALID_SOURCE");
 });
});
