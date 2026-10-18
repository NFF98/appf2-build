// APPf2 16P: live, fail-closed operational probes, not simulated positive E2E.
// Actions tokens are READ ONLY. Never merge, close, activate or invent Human grants.
// Each row distinguishes a genuine executed command from full protected lifecycle proof.
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {resolveRunnablePlan} from "./select-impacted-tests.mjs";
const REQUIRED=["1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","16"];
const repo=process.env.GITHUB_REPOSITORY;
const prNumber=Number(process.env.PR_NUMBER);
const head=process.env.PR_HEAD;
const tmp=process.env.RUNNER_TEMP||"/tmp";
const rows=[],fatal=[];
if(!/^[-\w.]+\/[-\w.]+$/.test(repo||"")||!Number.isInteger(prNumber)||prNumber<=0||
 !/^[a-f0-9]{40}$/.test(head||""))throw Error("HARD_STOP: missing exact PR repository/number/HEAD");
const evidenceDir=path.join(tmp,"16p-real-e2e");
fs.mkdirSync(evidenceDir,{recursive:true});
const exec=(cmd,args=[],timeout=120000)=>{
 const started=Date.now();
 const r=spawnSync(cmd,args,{encoding:"utf8",timeout,maxBuffer:8000000,
   env:{...process.env,CI:"true"}});
 return {command:[cmd,...args].join(" "),exit:r.status,
  duration_ms:Date.now()-started,error:r.error?.message||null,
  stdout:r.stdout||"",stderr:(r.stderr||"").slice(-5000)};
};
const gh=(route)=>exec("gh",["api","repos/"+repo+"/"+route],60000);
const node=(...args)=>exec(process.execPath,args,120000);
const parse=r=>{try{return JSON.parse(r.stdout)}catch{return null}};
const receipt=(id,description,operations,observed,...tail)=>{
 const [missing,verdict="PARTIAL"]=tail;
 const permitted=new Set(["PARTIAL","AUTHORITY_REQUIRED","NOT_RUN","FAIL","CHECK_PASS"]);
 if(!permitted.has(verdict))throw Error("unknown 16P verdict: "+verdict);
 if(rows.some(x=>x.id===id)||!REQUIRED.includes(id))throw Error("duplicate/unknown item "+id);
 if(!Array.isArray(operations)||!operations.length)throw Error("no operation for "+id);
 const item={id,description,operation_verdict:verdict,
  complete_real_e2e:"NOT_VERIFIED",protected_mutation_performed:false,
  authenticated_main_ssot_contract_verified:ssotContractVerified,
  github_provider_main_ruleset_verified:providerMainRulesetVerified,
  provider_prewrite_authority_verified:false,
  observed,missing,operations};
 rows.push(item);
 fs.writeFileSync(path.join(evidenceDir,id+".json"),JSON.stringify(item,null,2)+"\n");
 console.log("16P "+id+" | "+verdict+" | FULL_REAL_E2E=NOT_VERIFIED | "+description);
};
const requireBool=(b,message)=>{if(!b)fatal.push(message)};
const canonical=gh("contents/delivery/CURRENT-SPRINT.json?ref=main");
const mainDoc=parse(canonical);
const decode=entry=>{try{return JSON.parse(Buffer.from(entry.content,"base64").toString())}catch{return null}};
const mainState=mainDoc?.type==="file"?decode(mainDoc):null;
const taskFile=gh("contents/delivery/sprints/SP-P1-003/tasks.json?ref=main");
const taskState=taskFile.exit===0?decode(parse(taskFile)):null;
const t008=taskState?.tasks?.find(t=>t.task_id==="T008");
// Verify governance from the authenticated GitHub MAIN SSOT and actual provider ruleset.
// Checking a PR-local JSON file alone lets the PR author alter its own authority.
const ssotFetch=gh("contents/harness/policy/governance-reform.json?ref=main");
const ssotEnvelope=parse(ssotFetch);
const ssotPolicy=ssotFetch.exit===0?decode(ssotEnvelope):null;
const rulesetFetch=gh("rulesets/23969502");
const providerRuleset=parse(rulesetFetch);
const REQUIRED_GATES=["ci","attack","governance","Analyze JavaScript / TypeScript"];
const humanEvents=["MARK_FINAL_READY","APPROVE_MERGE","APPROVE_CLOSURE"];
const ssotContractVerified=Boolean(
 ssotPolicy?.human_authority_accounts?.includes("NFF98") &&
 humanEvents.every(x=>ssotPolicy?.lifecycle?.human_only_events?.includes(x)) &&
 REQUIRED_GATES.every(x=>ssotPolicy?.full_gate_contexts?.includes(x)) &&
 ssotPolicy?.exception?.non_waivable_gates?.includes("HUMAN_MERGE") &&
 ssotPolicy?.lifecycle?.conditional_task_approval?.external_executor_required===true &&
 ssotPolicy?.lifecycle?.conditional_task_approval?.github_trust_anchor?.mandatory_environment_required_reviewers===true
);
const providerCheckRule=providerRuleset?.rules?.find(x=>x.type==="required_status_checks");
const providerContexts=(providerCheckRule?.parameters?.required_status_checks||[]).map(x=>x.context);
const providerMainRulesetVerified=Boolean(
 rulesetFetch.exit===0 && providerRuleset?.id===23969502 &&
 providerRuleset?.source==="NFF98/appf2-build" &&
 providerRuleset?.enforcement==="active" &&
 providerRuleset?.target==="branch" &&
 providerRuleset?.conditions?.ref_name?.include?.includes("~DEFAULT_BRANCH") &&
 Array.isArray(providerRuleset?.bypass_actors) &&
 providerRuleset.bypass_actors.length===0 &&
 providerRuleset?.rules?.some(x=>x.type==="pull_request") &&
 providerCheckRule?.parameters?.strict_required_status_checks_policy===true &&
 REQUIRED_GATES.every(x=>providerContexts.includes(x))
);
requireBool(ssotContractVerified,"Live authenticated MAIN SSOT policy contract missing or weakened");
requireBool(providerMainRulesetVerified,"Live provider MAIN ruleset missing, untrusted, or bypassable");
// A protected default-branch Ruleset does NOT intercept direct creation of PRs
// and is NOT a connector permission boundary. These require separately proven
// scoped tokens / trusted write executor before #8/#A/#F can fully PASS.
const directConnectorPrewriteProven=false;
const live=gh("pulls/"+prNumber);
const livePr=parse(live);
requireBool(live.exit===0&&livePr?.state==="open"&&livePr?.head?.sha===head,
 "REAL PR HEAD/state does not match the event");
const canonicalHistoricalTask=mainState?.status==="HOLD"&&mainState?.active_sprint===null&&
 mainState?.active_task===null&&t008?.status==="REVIEW";
requireBool((mainState?.active_sprint==="SP-P1-003"||canonicalHistoricalTask)&&t008?.task_id==="T008",
 "Canonical Main Task/Sprint record unexpectedly changed; no inherited authority");
if(canonicalHistoricalTask) console.log("16P CANONICAL: Sprint3 administrative HOLD, T008 historic REVIEW; no live Task authority");
const ctx=[canonical,taskFile,live,ssotFetch,rulesetFetch];
const history=node("harness/scripts/guarded-github-write.mjs","--operation","TASK_HISTORY_AUDIT",
 "--pr","386","--evidence-pr","387");
const p386=gh("pulls/386"),p387=gh("pulls/387");
const a386=parse(p386),a387=parse(p387);
const historicReady=a386?.merged===true&&a387?.merged===true&&
 a387?.base?.sha===a386.merge_commit_sha&&t008?.completion_evidence?.length===14;
receipt("1","One Task / one PR / merge / evidence / closure",
 [history,p386,p387,...ctx],{historic_implementation_merged:a386?.merged===true,
 historical_evidence_merged:a387?.merged===true,legacy_two_prs:386!==387,
 task_status:t008?.status,evidence_count:t008?.completion_evidence?.length,
 historical_merge_chain:historicReady},
 ["One authorized NEW Task must complete within ONE Task PR, including actual merge and Human closure"],
 historicReady?"PARTIAL":"FAIL");
requireBool(historicReady,"#1 historical real PR->Evidence linkage invalid");
const env=gh("environments/appf2-task-human-approval");
const taskGrant=node("harness/scripts/gpt-preflight.mjs","state",
 "--task","T008","--intent","REQUEST_APPROVAL");
receipt("2","One trusted Human grant from activation through merge/closure",
 [env,taskGrant],{github_environment_http_success:env.exit===0,
 canonical_status:t008?.status,command_exit:taskGrant.exit},
 ["Real single Human grant + independently verified approval provenance + completed positive merge/closure"],
 "AUTHORITY_REQUIRED");
const workflowRuns=gh("actions/workflows/ci.yml/runs?branch="+
 encodeURIComponent(livePr?.head?.ref||"")+"&per_page=100");
const runData=parse(workflowRuns);
const sample=runData?.workflow_runs||[];
const pushes=sample.filter(r=>r.event==="push");
const draft=sample.filter(r=>r.event==="pull_request");
const checks=gh("commits/"+head+"/check-runs?per_page=100");
receipt("3","Draft/Ready CI optimization across real merge",
 [workflowRuns,checks],{branch_workflow_sample_size:sample.length,
 branch_pushes_in_sample:pushes.length,pr_events_in_sample:draft.length,
 check_inventory_available:checks.exit===0,history_complete:false},
 ["A genuinely authorized Draft->Ready->Merge lifecycle and Main run-after-merge observation"],
 workflowRuns.exit===0&&checks.exit===0?"PARTIAL":"FAIL");
const activation=node("harness/scripts/validate-activation.mjs");
const actualActivation=gh("pulls/385");
receipt("4","Activation only on genuine Task authority transition",
 [activation,actualActivation],{gate_exit:activation.exit,
 historic_activation_merged:parse(actualActivation)?.merged===true},
 ["A new explicitly authorized real Activation positive change and no-activation same-lease branch"],
 "AUTHORITY_REQUIRED");
const baseline=node("harness/scripts/validate-baseline.mjs");
const build=gh("contents/build-spec/CURRENT.json?ref=main");
receipt("5","Rebind only when baseline/AC map changes",
 [baseline,build],{gate_exit:baseline.exit,baseline:decode(parse(build))?.active_baseline},
 ["An authorized real rebind and authorized same-baseline modification avoiding rebind"],
 "AUTHORITY_REQUIRED");
const evidenceReport=node("harness/scripts/evidence-ledger-report.mjs",
 "--reconcile-pr","386");
receipt("6","Evidence automatically aggregated in same Task PR",
 [evidenceReport,taskFile],{real_reconcile_command_executed:true,
 source_pr_merged:true,canonical_evidence_count:t008?.completion_evidence?.length,
 mutation_observed:false},
 ["Fresh active Task PR with trusted grant; Evidence normalized and committed on same PR, then verified on Main"],
 "PARTIAL");
const exceptCase=gh("contents/delivery/constitutional-cases/GOV-ATTACK-FIXTURE-CF-ISOLATION-001.json?ref=fix/attack-fixture-carry-forward-isolation");
const exception=decode(parse(exceptCase));
const special=node("harness/scripts/validate-special-approvals-and-carry-forward.mjs");
const liveClock=node("harness/scripts/16p-human-exception-live-clock.mjs");
receipt("7","Live scoped Human exception, expiry/revocation & protected effect",
 [exceptCase,special,liveClock],{existing_docket:exceptCase.exit===0,
 human_approval_recorded:!!exception?.human_approval,
 policy_gate_exit:special.exit,
 actual_wall_clock_temp_engine_exit:liveClock.exit,
 actual_wall_clock_engine_only:liveClock.exit===0,
 genuine_human_approved_closure_deferral_main:false,
 github_provider_protected_expiry_denial_observed:false,
 github_provider_protected_revocation_denial_observed:false},
 ["Authorized protected positive CLOSURE_DEFERRAL, real merged expiry/revocation, and provider rejection (temporary wall-clock sandbox is insufficient)"],
 liveClock.exit===0?"PARTIAL":"FAIL");
const pre=node("harness/scripts/guarded-github-write.mjs",
 "--operation","PR_CREATE","--task","T099");
receipt("8","Prewrite Task lease / PR / scope preflight",
 [pre,ssotFetch,rulesetFetch],{blocked_unapproved_create:pre.exit===3,
  authenticated_main_ssot_contract_verified:ssotContractVerified,
  github_provider_main_ruleset_verified:providerMainRulesetVerified,
  direct_connector_prewrite_verified:directConnectorPrewriteProven,
  host_side_pr_creation_interception:"NOT_VERIFIED"},
 ["Every GPT/external write tool routed through a non-bypassable host-side preflight"],
 pre.exit===3?"PARTIAL":"FAIL");
requireBool(pre.exit===3,"#8 unauthorized new Task PR not rejected");
const metric=node("harness/scripts/governance-metrics.mjs","--ref","origin/main",
 "--since","2026-10-10");
const metricOldLie=node("--input-type=module","-e",
 'import{fullCiRuns}from"./harness/scripts/governance-metrics.mjs";const s=fullCiRuns({complete:true,window_start:"2026-10-10",sample:{strategy:"newest",listed:1156,enriched:1,truncated:true},runs:[{id:101,name:"CI Gate",event:"pull_request",headSha:"a".repeat(40),headBranch:"branch",runAttempt:1,jobs:[{id:115,name:"ci",status:"completed",conclusion:"success",attempt:1}]}]});if(s.status!=="INCOMPLETE_SAMPLED"||s.full_ci_runs!==null)process.exit(8)');
receipt("9","Actual CI savings supported by complete comparable attempt/job census",
 [metric,metricOldLie],{metric_exit:metric.exit,
 sampled_data_cannot_count_as_whole:metricOldLie.exit===0},
 ["Complete pre/post PR CI census with attempted jobs and comparable workload baseline"],
 metricOldLie.exit===0?"PARTIAL":"FAIL");
requireBool(metricOldLie.exit===0,"#9 sampled metrics still claim entire window");
const reuse=node("harness/scripts/guarded-github-write.mjs",
 "--operation","PR_CREATE","--task","T008");
receipt("A","Creation-time guard against duplicate PR even after previous merge",
 [reuse,ssotFetch,rulesetFetch],{real_historical_merge:historicReady,
 blocked_duplicate_task_pr:reuse.exit===3,
 provider_precreate_authorization_enforced:"NOT_VERIFIED",
 historical_repo_guard_not_host_permission:directConnectorPrewriteProven===false},
 ["Direct GitHub UI/API creation requires non-bypassable provider-level enforcement"],
 reuse.exit===3?"PARTIAL":"FAIL");
requireBool(reuse.exit===3,"#A existing Task still able to issue unguarded PR");
const approval=node("harness/scripts/gpt-preflight.mjs","state",
 "--task","T008","--intent","REQUEST_APPROVAL");
receipt("B","Reuse approval instead of asking Human again for same scope",
 [approval,taskFile],{preflight_exit:approval.exit,existing_task_status:t008?.status},
 ["Real trusted grant reused through authorized end-to-end Human approval boundary"],
 "AUTHORITY_REQUIRED");
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
const plan=resolveRunnablePlan({mode:"E2E",scripts:["test:state-machine","test:contract"],
 not_run:[],reasons:[]},pkg,process.cwd());
const absent=plan.absent_suites.some(x=>x.script==="test:state-machine"&&x.files===0&&
 x.status==="NOT_RUN_NO_TEST_FILES");
const selected=plan.scripts.includes("test:contract")&&!plan.scripts.includes("test:state-machine");
const test=selected?exec("npm",["run","test:contract"],240000):
 {command:"npm run test:contract [not selected]",exit:null,stdout:"",stderr:""};
receipt("C","Actual file-based impacted test selection and executing real tests",
 [{command:"select runnable tests from real checkout",exit:absent&&selected?0:1,
  stdout:JSON.stringify(plan),stderr:""},test],
 {missing_suite_not_run:absent,contract_selected:selected,actual_vitest_exit:test.exit},
 ["Merge original 16P implementation to Main and verify the new selector on an authorized real Task"],
 absent&&selected&&test.exit===0?"CHECK_PASS":"FAIL");
requireBool(absent&&selected&&test.exit===0,"#C file selector or actual Vitest failed");
const integrity=node("harness/scripts/validate-test-integrity.mjs");
const proofLevel=node("harness/scripts/validate-evidence.mjs");
// An earlier real GitHub Actions run on the SAME exact HEAD can supply #D
// operational proof. The matching job must actually complete both real test
// steps successfully. Current/unfinished jobs, other SHAs and mock fixtures
// are never admissible, and this never implies a Product/Main closure.
const dRunsQuery=gh("actions/runs?head_sha="+head+"&per_page=30");
const dRuns=(parse(dRunsQuery)?.workflow_runs||[]).filter(r=>
 r.head_sha===head &&
 (r.id===Number(process.env.GITHUB_RUN_ID) || r.status==="completed") &&
 r.event==="pull_request" &&
 r.path===".github/workflows/governance-gate.yml" &&
 r.head_repository?.full_name===repo).slice(0,5);
const dInventories=dRuns.map(r=>({
 run:r,operation:gh("actions/runs/"+r.id+"/jobs?per_page=100")}));
const dSteps=[
 "Bootstrap Supabase request roles in disposable real PostgreSQL",
 "Real PostgreSQL migration / RLS / PostgREST exposure tests (no SKIP accepted)",
 "Install actual Chromium browser",
 "Real Chromium UI interactions and production-handler harness (no SKIP accepted)"
];
const dMatches=dInventories.flatMap(({run,operation})=>{
 const list=parse(operation);
 if(operation.exit!==0 || !Array.isArray(list?.jobs) ||
   list.total_count!==list.jobs.length || list.jobs.length>100)return [];
 return list.jobs.filter(job=>job.run_id===run.id && job.head_sha===head &&
   job.status==="completed" && job.conclusion==="success" &&
   dSteps.every(name=>job.steps?.some(s=>s.name===name &&
      s.status==="completed" && s.conclusion==="success"))).map(job=>({
    run_id:run.id,job_id:job.id,run_head:run.head_sha,
    run_url:run.html_url,job_url:job.html_url
   }));
});
const dRealProof=dMatches.length>0;
receipt("D","REAL PostgreSQL and browser proof classification (no Mock upgrade)",
 [integrity,proofLevel,dRunsQuery,...dInventories.map(x=>x.operation)],
 {integrity_exit:integrity.exit,evidence_gate_exit:proofLevel.exit,
  exact_head_completed_real_pg_chromium_jobs:dMatches,
  real_pg_browser_operations_verified:dRealProof,
  protected_product_main_acceptance_proven:false},
 ["Actual PostgreSQL and Chromium job proof is independent of the required protected Product/Main acceptance and closure"],
 dRealProof?"CHECK_PASS":"AUTHORITY_REQUIRED");
const evidencePre=node("harness/scripts/guarded-github-write.mjs",
 "--operation","EVIDENCE_NORMALIZE","--pr",String(prNumber),"--apply");
receipt("E","Canonical evidence dedupe + protected Registry mutation",
 [evidencePre,evidenceReport],{governance_pr_blocked:evidencePre.exit===3,
 actual_canonical_mutation:false},
 ["Trusted Human granted active Product PR + protected Registry write receipt with real deduped AC/Test proof"],
 evidencePre.exit===3?"PARTIAL":"FAIL");
requireBool(evidencePre.exit===3,"#E governance PR permitted Product Evidence write");
const denyMerge=node("harness/scripts/guarded-github-write.mjs",
 "--operation","TASK_MERGE","--pr",String(prNumber),"--apply");
const denyClosure=node("harness/scripts/guarded-github-write.mjs",
 "--operation","TASK_CLOSURE","--pr",String(prNumber),"--apply");
receipt("F","GPT orchestration must refuse unauthorized merge and closure",
 [denyMerge,denyClosure,ssotFetch,rulesetFetch],{unauthorized_merge_denied:denyMerge.exit===3,
 unauthorized_closure_denied:denyClosure.exit===3,
 authenticated_main_ssot_contract_verified:ssotContractVerified,
 provider_main_ruleset_verified:providerMainRulesetVerified,
 direct_connector_human_authority_enforced:"NOT_VERIFIED"},
 ["Connector/UI/API host-level mandatory preflight proven across every authorized and rejected action"],
 denyMerge.exit===3&&denyClosure.exit===3?"PARTIAL":"FAIL");
requireBool(denyMerge.exit===3&&denyClosure.exit===3,"#F unauthorized protected action not denied");
const design=exec("gh",["api","repos/NFF98/appf2-design/branches/main"],60000);
const buildMain=gh("branches/main");
receipt("16","Design+Build protected two-repository change and truthful combined closure",
 [design,buildMain],{design_main_read:design.exit===0,
 build_main_read:buildMain.exit===0},
 ["Human-approved real Design+Build protected change, separate exact-head checks, protected Main writes, independent closure"],
 "AUTHORITY_REQUIRED");
requireBool(rows.length===16&&REQUIRED.every((x,i)=>rows[i]?.id===x),"16P missing/duplicate operations");
const tally=Object.fromEntries(["CHECK_PASS","PARTIAL","AUTHORITY_REQUIRED","NOT_RUN","FAIL"].map(s=>
 [s,rows.filter(r=>r.operation_verdict===s).length]));
// IMPORTANT: CHECK_PASS is NOT E2E PASS. Only independently proven protected
// lifecycle receipts can mark full E2E complete, which this read-only token cannot obtain.
const verifiedFullCount=rows.filter(r=>r.complete_real_e2e==="PASS").length;
const result={schema:"APPF2-16P-REAL-EOE-STRICT-1",source:"LIVE_GITHUB_ACTIONS",
 pr:prNumber,head,run_id:process.env.GITHUB_RUN_ID,
 attempted_items:rows.length,operational_counts:tally,
 full_real_e2e_pass_count:verifiedFullCount,
 main_closure_pass_count:0, // Not yet authenticated; NEVER extrapolate from tests or PR checks.
 runner_attempted_protected_mutations:false,
 provider_wide_no_unauthorized_mutations:"NOT_VERIFIED",
 ssot_protection_receipt:{
  main_policy_ref:"main",main_policy_blob_sha:ssotEnvelope?.sha||null,
  policy_contract_verified:ssotContractVerified,
  github_ruleset_id:providerRuleset?.id||null,
  github_ruleset_protected_default_branch:providerMainRulesetVerified,
  github_ruleset_contexts:providerContexts,
  direct_connector_prewrite_authority:"NOT_VERIFIED",
  human_only_events:humanEvents
 },
 historical_invalid_run:"39003122776:VOID_INVALID_METHOD",
 harness_failures:fatal,items:rows.map(({operations,...rest})=>({...rest,
  operation_count:operations.length,
  operation_failure_count:operations.filter(o=>o.exit!==0&&o.exit!==3).length}))};
// Fail CLOSED: zero real protected Main closure receipts cannot be promoted by a green
// read-only runner. A 16/16 local probe inventory is not a 16/16 E2E acceptance.
const fullyAdmitted=verifiedFullCount===REQUIRED.length &&
  result.main_closure_pass_count>0 && ssotContractVerified && providerMainRulesetVerified &&
  directConnectorPrewriteProven && fatal.length===0 && tally.FAIL===0;
result.full_real_e2e_admitted=fullyAdmitted;
result.final_verdict=fullyAdmitted?"FULL_REAL_E2E_PASS":"INCOMPLETE_REAL_E2E_HARD_STOP";
fs.writeFileSync(path.join(tmp,"16p-real-e2e.json"),JSON.stringify(result,null,2)+"\n");
const summary=["## 16P STRICT REAL E2E: "+
 result.full_real_e2e_pass_count+"/16 complete",
 "Actual GitHub APIs and runnable commands performed: "+rows.length+"/16;",
 "Local-operation CHECK_PASS is NOT a full protected lifecycle PASS.",
 "GitHub MAIN SSOT verified="+ssotContractVerified+
 "; provider protected-main Ruleset verified="+providerMainRulesetVerified+
 "; connector-wide prewrite authority=NOT_VERIFIED.",
 "Full real E2E admission: "+result.final_verdict+"; required 16/16 plus authenticated Main closure evidence.",
 "Operation verdicts "+JSON.stringify(tally),
 "Human approval, protected Merge/Closure and cross-repo writes NEVER simulated.",
 ...rows.map(r=>"- #"+r.id+" "+r.operation_verdict+" (full="+r.complete_real_e2e+") — "+r.missing.join("; ")),
 ...(fatal.length?["HARD_STOP: "+fatal.join("; ")]:[])].join("\n")+"\n";
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
if(!fullyAdmitted)console.error("16P HARD_STOP: real protected E2E incomplete; "+
 verifiedFullCount+"/16; authenticated Main closures="+result.main_closure_pass_count);
if(fatal.length||tally.FAIL||!fullyAdmitted)process.exitCode=1;
