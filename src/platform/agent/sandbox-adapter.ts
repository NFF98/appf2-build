import type {AgentToolCall} from "./agent-contract.js";
import type {ProjectSnapshot} from "./project-workspace.js";
/**
 * This is a PORT, not an implemented cloud container.
 * No model-created command is ever run by the GitHub runner or main Worker.
 */
export type SandboxLimits={
 readonly wall_time_ms:number;
 readonly cpu_millis:number;
 readonly memory_mb:number;
 readonly disk_mb:number;
 readonly network_policy:"DENY_ALL"|"ALLOWLIST_ONLY";
 readonly allowed_hosts:readonly string[];
};
export type SandboxEvidence={
 readonly call_id:string;
 readonly project_hash:string;
 readonly exit_code:number|null;
 readonly timed_out:boolean;
 readonly output_digest:string;
 readonly runner_attestation:string|null;
 readonly detail:string;
};
export interface CloudSandboxAdapter{
 provision(job_id:string,limits:SandboxLimits):Promise<{sandbox_id:string}>;
 execute(sandbox_id:string,project:ProjectSnapshot,call:AgentToolCall):Promise<SandboxEvidence>;
 destroy(sandbox_id:string):Promise<void>;
}
// eslint-disable-next-line complexity -- Security bounds are explicit and fail closed.
export function validateSandboxLimits(input:SandboxLimits):void{
 if(!Number.isInteger(input.wall_time_ms)||input.wall_time_ms<100||
   input.wall_time_ms>600000||!Number.isInteger(input.cpu_millis)||
   input.cpu_millis<100||input.cpu_millis>600000||
   !Number.isInteger(input.memory_mb)||input.memory_mb<64||input.memory_mb>8192||
   !Number.isInteger(input.disk_mb)||input.disk_mb<16||input.disk_mb>8192||
   !["DENY_ALL","ALLOWLIST_ONLY"].includes(input.network_policy)||
   input.allowed_hosts.length>16||
   (input.network_policy==="DENY_ALL"&&input.allowed_hosts.length!==0)||
   input.allowed_hosts.some(h=>!/^[a-z0-9.-]{1,128}$/u.test(h)||
     h==="localhost"||h.endsWith(".localhost")||/^[0-9.]+$/u.test(h)))
   throw Error("SANDBOX_LIMITS_UNSAFE");
}
