// APPf2 GOV-CASE-T006-REBIND-001 R4 audit-only model.
// This is not a production Human signature adapter or Sprint activation.
const TARGET='BS-P1-025';
const MAIN='refs/heads/main';
const REPO='NFF98/appf2-build';
const WORKFLOW='.github/workflows/revalidation-proof.yml';
const fail=code=>({ok:false,code});
const sha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s)&&!/^0+$/.test(s);
const digest=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const uniq=a=>Array.isArray(a)&&a.length>0&&a.every(x=>typeof x==='string'&&x.length>0)&&new Set(a).size===a.length;
const getTask=(snap,expected)=>snap.tasks?.tasks?.find(t=>t.task_id===expected.task_id);
const runIdentity=(e,env)=>e.repo===REPO&&e.ref===MAIN&&e.workflow===WORKFLOW&&
 sha(e.source_sha)&&Number.isSafeInteger(e.run_id)&&e.run_id>0&&
 Number.isSafeInteger(e.run_attempt)&&e.run_attempt>0&&
 env?.GITHUB_REPOSITORY===e.repo&&env.GITHUB_EVENT_NAME==='push'&&
 env.GITHUB_REF===e.ref&&env.GITHUB_SHA===e.source_sha&&
 Number(env.GITHUB_RUN_ID)===e.run_id&&Number(env.GITHUB_RUN_ATTEMPT)===e.run_attempt;
const buildActive=s=>s.build?.active_baseline===TARGET&&s.build.implementation_enabled===true;
const baselineApproved=s=>s.manifest?.baseline_id===TARGET&&s.manifest.status==='LOCKED'&&
 s.manifest.approval?.status==='USER_APPROVED'&&Boolean(s.manifest.approval.decision_ref);
const activationBound=s=>s.activation?.baseline_id===TARGET&&s.activation.status==='USER_APPROVED'&&
 s.activation.type==='REBASELINE'&&s.activation.previous_baseline==='BS-P1-024'&&
 s.activation.source_working_commit===s.manifest.source_working_commit&&Boolean(s.activation.decision_ref);
const activationValid=(s,e)=>buildActive(s)&&baselineApproved(s)&&activationBound(s)&&e.target_baseline===TARGET;
const activeSprint=(s,e)=>s.sprint?.status==='ACTIVE'&&s.sprint.active_sprint===e.sprint_id&&
 s.sprint.active_task===e.task_id&&s.sprint.active_build_spec===TARGET;
const alignedSprint=(s,e)=>s.tasks?.sprint_id===e.sprint_id&&
 s.sprintManifest?.sprint_id===e.sprint_id&&s.sprintManifest.status==='ACTIVE'&&
 s.sprintManifest.build_spec_id===TARGET;
const sprintValid=(s,e)=>activeSprint(s,e)&&alignedSprint(s,e);
const taskValid=(t,e)=>t?.task_id===e.task_id&&t.status==='IN_PROGRESS'&&
 t.build_spec_id===TARGET&&Array.isArray(t.allowed_write_paths)&&
 uniq(t.acceptance_links?.map(x=>x.acceptance_id))&&
 uniq(t.acceptance_links?.map(x=>x.test_id))&&
 t.acceptance_links.length===e.acceptance_ids.length&&
 t.acceptance_links.every((x,i)=>x.acceptance_id===e.acceptance_ids[i]&&x.test_id===e.test_ids[i]);
const registryValid=(s,e)=>digest(e.source_registry_sha256)&&digest(e.target_registry_sha256)&&
 s.manifest.acceptance_registry==='registries/acceptance-test-registry.json'&&
 s.manifest.file_inventory?.find(x=>x.path===s.manifest.acceptance_registry)?.sha256===e.target_registry_sha256&&
 s.actual_registry_sha256===e.target_registry_sha256&&
 s.source_registry_sha256===e.source_registry_sha256;
const approvable=e=>e.case_id==='GOV-CASE-T006-REBIND-001'&&
 e.target_baseline===TARGET&&uniq(e.acceptance_ids)&&uniq(e.test_ids)&&
 e.test_ids.length===e.acceptance_ids.length&&typeof e.task_id==='string'&&
 typeof e.sprint_id==='string'&&typeof e.evidence_id==='string';
export function inspectAuthorizedPreflight({expected:e,snapshot:s,env,verifyIndependentApproval,verifyGitAncestry}){
 if(!e||!s)return fail('MISSING_CANONICAL_INPUT');
 if(!runIdentity(e,env))return fail('UNTRUSTED_WORKFLOW_RUN');
 if(!activationValid(s,e))return fail('NO_AUTHORIZED_BS025_ACTIVATION');
 if(!sprintValid(s,e))return fail('SPRINT_NOT_ACTIVELY_AUTHORIZED');
 if(!taskValid(getTask(s,e),e))return fail('OWNER_TASK_OR_TEST_MAPPING_INVALID');
 if(!registryValid(s,e))return fail('REGISTRY_HASH_NOT_PINNED');
 if(!approvable(e))return fail('CASE_SCOPE_NOT_BOUND');
 if(typeof verifyIndependentApproval!=='function'||verifyIndependentApproval({expected:e,snapshot:s})!==true)return fail('MISSING_INDEPENDENT_HUMAN_APPROVAL');
 if(typeof verifyGitAncestry!=='function'||verifyGitAncestry({expected:e,snapshot:s})!==true)return fail('GIT_ANCESTRY_UNVERIFIED');
 return {ok:true,code:'SYNTHETIC_STRUCTURAL_APPROVAL_MODEL_ONLY'};
}
// Auditing this module does not enable any production launcher.
if(process.argv[1]?.endsWith('R4-AUTHORIZED-PREFLIGHT.mjs')&&process.argv[2]==='authorize'){
 console.error('R4 ISOLATED PREFLIGHT: no independent trusted signer or activation; FAIL CLOSED');
 process.exitCode=2;
}
