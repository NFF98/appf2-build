import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';

const HEX40=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const MODES=new Set(['FULL_COPY','SECTION_FILTERED','REFERENCE_ONLY']);
const FREEZE_VERIFICATION=new Set(['SELF_MARKER','UI_REFERENCE_INVENTORY','REFERENCE_ONLY_DECLARATION']);

const isObject=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const isSafeRelative=p=>typeof p==='string' && p.length>0 && !p.startsWith('/') && !p.includes('\\') && !p.split('/').includes('..');
const assertInto=(errors,condition,message)=>{if(!condition) errors.push(message);};

const validateSelector=(errors,selector,kind,label)=>{
  assertInto(errors,isObject(selector),label+' must be object');
  if(!isObject(selector)) return;
  const allowed=kind==='start' ? new Set(['BOF','EXACT_HEADING']) : new Set(['EOF','EXACT_HEADING']);
  assertInto(errors,allowed.has(selector.type),label+' invalid selector type: '+selector.type);
  if(selector.type==='EXACT_HEADING'){
    assertInto(errors,typeof selector.value==='string' && selector.value.length>0,label+' EXACT_HEADING value missing');
    assertInto(errors,typeof selector.value==='string' && /^#{1,6}\s/.test(selector.value),label+' EXACT_HEADING must be a full Markdown heading line');
  }
};

const validateExpectedIdentity=(errors,map,{expectedBaselineId,expectedSourceRepo,expectedSourceCommit})=>{
  if(expectedBaselineId!==null) assertInto(errors,map.baseline_id===expectedBaselineId,'baseline_id mismatch');
  if(expectedSourceRepo!==null) assertInto(errors,map.source_repo===expectedSourceRepo,'source_repo mismatch');
  if(expectedSourceCommit!==null) assertInto(errors,map.source_commit===expectedSourceCommit,'source_commit mismatch');
};

const validateIdentity=(errors,map,expected)=>{
  assertInto(errors,map.schema_version===1,'schema_version must be 1');
  assertInto(errors,/^BS-P\d+-\d{3}$/.test(map.baseline_id||''),'invalid baseline_id');
  assertInto(errors,/^PHASE_\d+$/.test(map.phase||''),'invalid phase');
  assertInto(errors,typeof map.source_repo==='string' && map.source_repo.length>0,'source_repo missing');
  assertInto(errors,HEX40.test(map.source_commit||''),'invalid source_commit');

  validateExpectedIdentity(errors,map,expected);

  const phaseNumber=(map.phase||'').match(/^PHASE_(\d+)$/)?.[1]||null;
  const baselinePhase=(map.baseline_id||'').match(/^BS-P(\d+)-/)?.[1]||null;
  if(phaseNumber && baselinePhase) assertInto(errors,phaseNumber===baselinePhase,'phase does not match baseline_id');
};

const validateFreezeAudit=(errors,map)=>{
  assertInto(errors,isObject(map.freeze_audit),'freeze_audit missing');
  if(isObject(map.freeze_audit)){
    assertInto(errors,map.freeze_audit.status==='PASS','freeze_audit.status must be PASS');
    assertInto(errors,map.freeze_audit.version_lock===true,'freeze_audit.version_lock must be true');
    assertInto(errors,map.freeze_audit.source_commit===map.source_commit,'freeze_audit.source_commit must equal source_commit');
  }
};

const validateProjectionEngine=(errors,map)=>{
  assertInto(errors,isObject(map.projection_engine),'projection_engine missing');
  if(isObject(map.projection_engine)){
    assertInto(errors,map.projection_engine.version==='MARKDOWN_EXACT_HEADING_V1','unsupported projection engine version');
    assertInto(errors,map.projection_engine.matching==='EXACT_ONLY','projection matching must be EXACT_ONLY');
    assertInto(errors,map.projection_engine.fuzzy_matching===false,'fuzzy_matching must be false');
    assertInto(errors,map.projection_engine.llm_classification===false,'llm_classification must be false');
  }
};

const validateProjectedPaths=(errors,entry,label,targetPaths)=>{
  assertInto(errors,isSafeRelative(entry.target_path),label+' invalid target_path');
  assertInto(errors,entry.target_path!=='manifest.json' && entry.target_path!=='projection-map.json',label+' target_path uses reserved baseline file');
  assertInto(errors,HEX64.test(entry.output_sha256||''),label+' invalid output_sha256');
  if(!isSafeRelative(entry.target_path)) return;
  assertInto(errors,!targetPaths.has(entry.target_path),label+' duplicate target_path: '+entry.target_path);
  targetPaths.add(entry.target_path);
};

const validateFullCopy=(errors,entry,label)=>{
  if(entry.mode!=='FULL_COPY') return;
  assertInto(errors,entry.include_blocks===undefined || (Array.isArray(entry.include_blocks) && entry.include_blocks.length===0),label+' FULL_COPY cannot use include_blocks');
};

const validateSectionFiltered=(errors,entry,label)=>{
  if(entry.mode!=='SECTION_FILTERED') return;
  assertInto(errors,Array.isArray(entry.include_blocks) && entry.include_blocks.length>0,label+' SECTION_FILTERED requires include_blocks');
  if(!Array.isArray(entry.include_blocks)) return;
  for(let blockIndex=0;blockIndex<entry.include_blocks.length;blockIndex++){
    const block=entry.include_blocks[blockIndex];
    const blockLabel=label+'.include_blocks['+blockIndex+']';
    assertInto(errors,isObject(block),blockLabel+' must be object');
    if(!isObject(block)) continue;
    validateSelector(errors,block.start,'start',blockLabel+'.start');
    validateSelector(errors,block.end_before,'end',blockLabel+'.end_before');
  }
};

const validateReferenceOnly=(errors,entry,label)=>{
  if(entry.mode!=='REFERENCE_ONLY') return;
  assertInto(errors,typeof entry.exclusion_reason==='string' && entry.exclusion_reason.length>0,label+' REFERENCE_ONLY requires exclusion_reason');
  assertInto(errors,entry.target_path===undefined,label+' REFERENCE_ONLY cannot have target_path');
  assertInto(errors,entry.output_sha256===undefined,label+' REFERENCE_ONLY cannot have output_sha256');
  assertInto(errors,entry.include_blocks===undefined,label+' REFERENCE_ONLY cannot have include_blocks');
  assertInto(errors,entry.freeze_audit_verification==='REFERENCE_ONLY_DECLARATION',label+' REFERENCE_ONLY must use REFERENCE_ONLY_DECLARATION');
};

const validateEntry=(errors,entry,index,context)=>{
  const label='entry['+index+']';
  assertInto(errors,isObject(entry),label+' must be object');
  if(!isObject(entry)) return;

  assertInto(errors,isSafeRelative(entry.source_path),label+' invalid source_path');
  assertInto(errors,HEX40.test(entry.source_blob_sha||''),label+' invalid source_blob_sha');
  assertInto(errors,MODES.has(entry.mode),label+' invalid mode: '+entry.mode);
  assertInto(errors,entry.phase_scope===context.expectedPhaseScope,label+' phase_scope mismatch');
  assertInto(errors,FREEZE_VERIFICATION.has(entry.freeze_audit_verification),label+' invalid freeze_audit_verification');

  if(isSafeRelative(entry.source_path)){
    assertInto(errors,!context.sourcePaths.has(entry.source_path),label+' duplicate source_path: '+entry.source_path);
    context.sourcePaths.add(entry.source_path);
  }

  if(entry.mode==='FULL_COPY' || entry.mode==='SECTION_FILTERED'){
    validateProjectedPaths(errors,entry,label,context.targetPaths);
  }
  validateFullCopy(errors,entry,label);
  validateSectionFiltered(errors,entry,label);
  validateReferenceOnly(errors,entry,label);
};

export function validateProjectionMap(map,{expectedBaselineId=null,expectedSourceRepo=null,expectedSourceCommit=null}={}){
  const errors=[];
  assertInto(errors,isObject(map),'projection map must be object');
  if(!isObject(map)) return errors;

  validateIdentity(errors,map,{expectedBaselineId,expectedSourceRepo,expectedSourceCommit});
  validateFreezeAudit(errors,map);
  validateProjectionEngine(errors,map);
  assertInto(errors,Array.isArray(map.entries) && map.entries.length>0,'entries must be non-empty array');
  if(!Array.isArray(map.entries)) return errors;

  const context={
    sourcePaths:new Set(),
    targetPaths:new Set(),
    expectedPhaseScope:map.phase ? map.phase+'_APPLICABLE_TRUTH_ONLY' : null
  };
  for(let index=0;index<map.entries.length;index++) validateEntry(errors,map.entries[index],index,context);

  return errors;
}

export const sha256Buffer=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
export const gitBlobSha=buffer=>crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+buffer.length+'\0'),buffer])).digest('hex');

const locateExactHeading=(lines,value,label)=>{
  const matches=[];
  lines.forEach((line,index)=>{if(line===value) matches.push(index);});
  if(matches.length!==1) throw new Error(label+' expected exactly one heading match, found '+matches.length+': '+value);
  return matches[0];
};

export function selectMarkdownExactHeadingV1(buffer,blocks,context='projection'){
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
  catch{throw new Error(context+' SECTION_FILTERED source must be valid UTF-8');}
  const normalized=text.replace(/\r\n?/g,'\n');
  const lines=normalized.split('\n');
  const parts=[];
  let previousEnd=-1;

  blocks.forEach((block,index)=>{
    const label=context+' block['+index+']';
    const start=block.start.type==='BOF' ? 0 : locateExactHeading(lines,block.start.value,label+'.start');
    const end=block.end_before.type==='EOF' ? lines.length : locateExactHeading(lines,block.end_before.value,label+'.end_before');
    if(start>=end) throw new Error(label+' start must be before end_before');
    if(previousEnd>start) throw new Error(label+' overlaps or is out of source order');
    parts.push(lines.slice(start,end).join('\n'));
    previousEnd=end;
  });

  let output=parts.join('\n');
  if(!output.endsWith('\n')) output+='\n';
  return Buffer.from(output,'utf8');
}

export function projectEntry(entry,sourceBuffer){
  const blobSha=gitBlobSha(sourceBuffer);
  if(blobSha!==entry.source_blob_sha) throw new Error(entry.source_path+' source_blob_sha mismatch: expected '+entry.source_blob_sha+', got '+blobSha);
  if(entry.mode==='REFERENCE_ONLY') return null;

  const output=entry.mode==='FULL_COPY'
    ? Buffer.from(sourceBuffer)
    : selectMarkdownExactHeadingV1(sourceBuffer,entry.include_blocks,entry.source_path);

  const digest=sha256Buffer(output);
  if(digest!==entry.output_sha256) throw new Error(entry.source_path+' output_sha256 mismatch: expected '+entry.output_sha256+', got '+digest);
  return {buffer:output,sha256:digest};
}
