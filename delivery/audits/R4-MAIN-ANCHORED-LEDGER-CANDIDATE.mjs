// APPf2 R4 OPTION C, audit-only proposal. Not deployed or constitutional authority.
// A protected, linear GitHub main commit is the proposed durable ledger anchor.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {inspectLedger} from './R4-REPLAY-LEDGER.mjs';

const REPO='NFF98/appf2-build';
const DEFAULT_RULESET=23969502;
const LEDGER_PATH='delivery/audits/revalidation-proof-ledger.json';
const SHA=/^[0-9a-f]{40}$/;
const fail=code=>({ok:false,code});
const checks=new Set(['ci','attack','governance','Analyze JavaScript / TypeScript']);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const configOk=rs=>rs?.enforcement==='active'&&
 rs?.conditions?.ref_name?.include?.includes('~DEFAULT_BRANCH')&&
 Array.isArray(rs?.bypass_actors)&&rs.bypass_actors.length===0&&
 ['non_fast_forward','deletion','pull_request','required_status_checks'].every(t=>rs.rules?.some(x=>x.type===t));
const strictChecks=rs=>{
 const param=rs.rules.find(x=>x.type==='required_status_checks').parameters;
 const actual=new Set((param?.required_status_checks||[]).map(x=>x.context));
 return param?.strict_required_status_checks_policy===true&&[...checks].every(x=>actual.has(x));
};
const trustRuleset=rs=>configOk(rs)&&strictChecks(rs);
const validSHA=x=>typeof x==='string'&&SHA.test(x)&&!/^0+$/.test(x);
const oneAppend=(before,after)=>after.entries.length===before.entries.length+1&&
 before.entries.every((e,i)=>equal(e,after.entries[i]))&&
 equal(after.entries[after.entries.length-1]?.previous,before.head);
const validateSnapshot=ledger=>ledger?.schema_version===1&&Array.isArray(ledger.entries)&&
 typeof ledger.head==='string'&&inspectLedger({entries:ledger.entries,externallyTrustedHead:ledger.head}).ok;

export function inspectProposedMainAnchor({repository,baseSha,headSha,liveMainSha,ruleset,baseLedger,proposedLedger,isBaseAncestor}){
 if(repository!==REPO||!validSHA(baseSha)||!validSHA(headSha)||!validSHA(liveMainSha))return fail('UNTRUSTED_MAIN_IDENTITY');
 if(!trustRuleset(ruleset))return fail('MAIN_RULESET_NOT_PROTECTING_LEDGER');
 if(baseSha!==liveMainSha)return fail('STALE_BASE_REVALIDATION_REQUIRED');
 if(isBaseAncestor!==true)return fail('UNRELATED_PR_HEAD');
 if(!validateSnapshot(baseLedger)||!validateSnapshot(proposedLedger))return fail('UNTRUSTED_LEDGER_BYTES');
 if(!oneAppend(baseLedger,proposedLedger))return fail('NON_APPEND_ONLY_OR_MULTI_WRITE');
 const added=proposedLedger.entries[proposedLedger.entries.length-1];
 if(!added||added.event?.repo!==REPO)return fail('UNTRUSTED_LEDGER_OWNER');
 return {ok:true,code:'CANDIDATE_STRICT_MAIN_PR_MERGE_REQUIRED',candidateHead:proposedLedger.head};
}

const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1048576}).trim();
const github=args=>JSON.parse(execFileSync('gh',['api',...args],{encoding:'utf8',maxBuffer:1048576,stdio:['ignore','pipe','pipe']}));
const showLedger=(root,sha)=>JSON.parse(git(root,['show',sha+':'+LEDGER_PATH]));
const ancestry=(root,a,b)=>{try{git(root,['merge-base','--is-ancestor',a,b]);return true}catch{return false}};

/** Inspects a protected-main PR, but NEVER merges or treats the candidate as Human-authorized.
 *  This requires GH_TOKEN from an independently trusted Actions job on exact GitHub PR event.
 *  It cannot create a ledger or bootstrap an unsigned genesis state.
 */
export function inspectGitHubMainLedgerPR({repoRoot=process.cwd(),baseSha,headSha}){
 if(process.env.GITHUB_REPOSITORY!==REPO||process.env.GITHUB_EVENT_NAME!=='pull_request')return fail('UNTRUSTED_GITHUB_EVENT');
 if(!validSHA(baseSha)||!validSHA(headSha))return fail('INVALID_SHA');
 let event;
 try{event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'))}
 catch{return fail('GITHUB_EVENT_NOT_AUTHENTICATED')}
 if(event?.pull_request?.base?.repo?.full_name!==REPO||
   event?.pull_request?.base?.ref!=='main'||
   event?.pull_request?.base?.sha!==baseSha||
   event?.pull_request?.head?.sha!==headSha)return fail('PR_BASE_OR_HEAD_NOT_BOUND_TO_GITHUB_EVENT');
 try{
  const remote=github(['repos/'+REPO+'/branches/main']);
  const ruleset=github(['repos/'+REPO+'/rulesets/'+DEFAULT_RULESET]);
  const baseLedger=showLedger(repoRoot,baseSha),proposedLedger=showLedger(repoRoot,headSha);
  return inspectProposedMainAnchor({repository:REPO,baseSha,headSha,liveMainSha:remote.commit.sha,
   ruleset,baseLedger,proposedLedger,isBaseAncestor:ancestry(repoRoot,baseSha,headSha)});
 }catch{return fail('LIVE_GITHUB_OR_GIT_PROVENANCE_UNAVAILABLE')}
}
if(process.argv[1]?.endsWith('R4-MAIN-ANCHORED-LEDGER-CANDIDATE.mjs')&&process.argv[2]==='merge'){
 console.error('R4 REVIEW ONLY: GitHub Ruleset and Human merge approval must be independently enforced');
 process.exitCode=2;
}
