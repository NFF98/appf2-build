/** Fail closed before creating a billable Agent Job when the live Worker
 * does not have every required service binding. No AI, DB or container calls.
 */
export async function requireAgentBuildReadiness():Promise<void>{
 let response:Response;
 try{response=await fetch("/api/v1/agent-readiness",
  {method:"GET",credentials:"same-origin",cache:"no-store"});}
 catch{throw Error("無法確認雲端 Agent 服務；已停止，沒有呼叫付費 AI。");}
 if(!response.ok)throw Error(
  "網站尚未部署新版多檔案 Agent 的完整服務；已停止，沒有呼叫付費 AI。");
 let body:unknown;
 try{body=await response.json();}catch{body=null;}
 if(!body||typeof body!=="object"||!("data" in body)||
  !body.data||typeof body.data!=="object"||
  !("status" in body.data)||body.data.status!=="CONFIGURED_NOT_VERIFIED"||
  !("can_start_paid_generation" in body.data)||
  body.data.can_start_paid_generation!==true)
  throw Error("AI／Sandbox／Browser QA 尚未全部配置；不會先付費生成不能驗收的 App。");
}
