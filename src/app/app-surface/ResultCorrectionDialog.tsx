import { useEffect, useRef, useState } from "react";
import type { RuntimeAppHandle } from "../../platform/runtime/runtime-operation.js";

type Mode="CHOOSE"|"RULE";
export type ResultCorrectionDialogProps={
  readonly app:RuntimeAppHandle;
  readonly onClose:()=>void;
  /** Only focuses an existing F03 input; the canonical F03 Runtime applies any user edit. */
  readonly onEditInputs:()=>boolean;
};
/** Free, honest S03 correction entry. It does not counterfeit an F16 child or paid compiler.
 * F16 semantic correction requires CORRECT lineage, F02 validation and a new version. */
export function ResultCorrectionDialog({app,onClose,onEditInputs}:ResultCorrectionDialogProps){
  const [mode,setMode]=useState<Mode>("CHOOSE");
  const [draft,setDraft]=useState("");
  const [recorded,setRecorded]=useState(false);
  const [noInputs,setNoInputs]=useState(false);
  const cancelRef=useRef<HTMLButtonElement>(null);
  // Canonical BEFORE output is frozen on entry. No DOM scraping and no live rule override.
  const [before]=useState(()=>app.result().filter(output=>output.status==="AVAILABLE").map(output=>({
    id:output.id,label:output.label,
    display:output.sensitivity==="NORMAL"?output.display:"（敏感結果不複製）"
  })));
  useEffect(()=>cancelRef.current?.focus({preventScroll:true}),[]);
  const edit=():void=>{
    const focused=onEditInputs();
    if(!focused)setNoInputs(true);
  };
  const record=():void=>{
    if(draft.trim().length<10)return;
    setRecorded(true);
  };
  return <div className="s03-sheet-backdrop" onClick={onClose}>
    <section className="s03-sheet s03-correction-dialog" role="dialog" aria-modal="true"
      aria-labelledby="s03-correction-title" onClick={event=>event.stopPropagation()}
      onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();onClose();}}}>
      <h2 className="s03-sheet-title" id="s03-correction-title">調整結果</h2>
      <p>目前 App 的結果（調整前）</p>
      <dl className="s03-result-list">
        {before.map(output=><div key={output.id} className="s03-result-item">
          <dt>{output.label}</dt><dd>{output.display}</dd>
        </div>)}
      </dl>
      {mode==="CHOOSE"?<>
        <p>你想調整的是輸入資料，還是計算規則？</p>
        <button type="button" className="s03-sheet-option" onClick={edit}>
          修改輸入值，立即重新計算（不用 AI）
        </button>
        {noInputs?<p role="alert">這個 App 沒有可編輯的輸入；未修改結果，也沒有呼叫 AI。</p>:null}
        <button type="button" className="s03-sheet-option" onClick={()=>setMode("RULE")}>
          計算規則不對，描述需要修正的地方
        </button>
      </>:<>
        <p>請描述哪個結果不符合預期，以及正確規則。原版會保留。</p>
        <label className="field-label" htmlFor="s03-correction-feedback">結果或計算規則哪裡錯了？</label>
        <textarea id="s03-correction-feedback" className="s05-input" maxLength={1500}
          value={draft} onChange={event=>{setDraft(event.target.value);setRecorded(false);}}
          placeholder="例如：主管分帳應該算兩份，不是所有人平均分。" />
        <p>這是 F16 邏輯修正需求，不是改顯示文字。真正修正必須產生並驗證新的 App 版本；目前尚未接通，不會私下呼叫付費 AI。</p>
        {recorded?<p role="status">描述已保留在此視窗供你修改，但尚未送出、沒有更改結果或產生新版。</p>:null}
        <button type="button" className="btn btn-secondary" disabled={draft.trim().length<10} onClick={record}>
          保留目前描述（不送出）
        </button>
        <button type="button" className="btn btn-ghost" onClick={()=>setMode("CHOOSE")}>返回選擇</button>
      </>}
      <button ref={cancelRef} type="button" className="btn btn-secondary s03-sheet-cancel" onClick={onClose}>返回 App</button>
    </section>
  </div>;
}
