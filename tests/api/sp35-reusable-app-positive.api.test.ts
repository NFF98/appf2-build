import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppDeliveryClient } from "../../src/app/runtime/app-delivery.js";
import { createBrowserRuntime, persistBrowserTabState } from "../../src/platform/runtime/browser/browser-runtime.js";
import { singletonKey } from "../../src/platform/runtime/node-instance-key.js";
import { evaluateResult } from "../../src/platform/runtime/result-evaluation.js";
import { FIRST_PARTY_ORIGIN, FirstPartyBrowser } from "./s03-first-party-client.js";
import { createS03Backend } from "./s03-worker-backend.js";

function persistentStorage(){
  const map=new Map<string,string>();
  return {
    getItem:(name:string)=>map.get(name)??null,
    setItem:(name:string,value:string)=>{map.set(name,value);},
    removeItem:(name:string)=>{map.delete(name);}
  };
}
afterEach(()=>vi.unstubAllGlobals());

describe("Sprint3.5 positive authenticated original-App reuse (NO PAID provider)",()=>{
  it("reopens identical server-validated Blueprint, runs a real registered F03 Action and restores state without rerunning F01/AI",async()=>{
    const storage=persistentStorage();
    vi.stubGlobal("localStorage",storage);
    vi.stubGlobal("sessionStorage",persistentStorage());
    const backend=createS03Backend();
    // The only fixture F01/F02 creation is a locally scripted model, not a paid provider.
    const browser=new FirstPartyBrowser(backend);
    const first=await browser.createValidated();
    const modelCalls=backend.modelCalls();
    expect(modelCalls).toBe(2);
    const sent:string[]=[];
    const delivery=createAppDeliveryClient(async (path,init)=>{
      if(init?.method==="POST" || path==="/api/v1/intents")throw new Error("reopen called paid create");
      sent.push(path);
      return browser.fetch(path,init);
    },browser.keyring);
    const opened=await delivery.deliver(first.intentId,first.contentHash);
    expect(opened.ok).toBe(true);
    if(!opened.ok)throw new Error("holder delivery must be executable");
    const runtime=createBrowserRuntime({body:opened.admitted.body,admission:opened.admitted.admission},first.intentId);
    await runtime.hydrate();
    expect(runtime.status).toBe("READY");
    expect(evaluateResult(runtime)?.outputs[0]).toMatchObject({status:"AVAILABLE",value:30});
    const receipt=runtime.dispatch({
      source_node_instance_key:singletonKey("node_people"),
      event_name:"change",payload:{value:6},origin:"USER"
    });
    expect(receipt.accepted).toBe(true);
    expect(evaluateResult(runtime)?.outputs[0]).toMatchObject({status:"AVAILABLE",value:20});
    persistBrowserTabState(runtime,first.intentId,first.contentHash);
    runtime.dispose();
    // Same original-holder later, still authenticates via fresh server grant and fresh F02 admission.
    vi.stubGlobal("sessionStorage",persistentStorage());
    const reopened=await delivery.deliver(first.intentId,first.contentHash);
    expect(reopened.ok).toBe(true);
    if(!reopened.ok)throw new Error("owner could not reopen without regeneration");
    const restored=createBrowserRuntime({body:reopened.admitted.body,admission:reopened.admitted.admission},first.intentId);
    await restored.hydrate();
    expect(restored.status).toBe("READY");
    expect(restored.readState("people")).toBe(6);
    expect(evaluateResult(restored)?.outputs[0]).toMatchObject({status:"AVAILABLE",value:20});
    restored.dispose();
    expect(backend.modelCalls()).toBe(modelCalls);
    expect(sent.filter(url=>url.startsWith("/api/v1/intents/") && url.includes("blueprint-access-grant"))).toHaveLength(2);
    expect(sent.filter(url=>url.startsWith("/api/v1/blueprints/") && url.includes("execution-admission"))).toHaveLength(2);
    expect(sent.filter(url=>url.startsWith("/b/"))).toHaveLength(2);
    expect(FIRST_PARTY_ORIGIN).toBe("https://appf2.test");
  });
});
