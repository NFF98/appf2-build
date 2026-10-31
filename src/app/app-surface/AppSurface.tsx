import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { RuntimeAppHandle, RuntimeResultView } from "../../platform/runtime/runtime-operation.js";
import { RuntimeProcessingPresenter } from "../runtime/runtime-processing.js";
import { RuntimeProcessingLayer } from "../runtime/RuntimeProcessingLayer.js";
import { Brand } from "../shell/Brand.js";
import { changeEntryFor, type AppSession, type ChangeChoice, type ChangeEntry } from "./app-session.js";
import { ResultCorrectionDialog } from "./ResultCorrectionDialog.js";

/** S03 entries handed to their owning surfaces (S05A / S05B, O01 Share, O02 Correction). */
export type AppSurfaceEntry = ChangeEntry | { readonly destination: "O01" } | { readonly destination: "O02" };

/** What the owner of an entry did with it; UNAVAILABLE means no owner in this build can take it. */
export type EntryHandoff = "HANDED_OFF" | "UNAVAILABLE";

type EntryDestination = AppSurfaceEntry["destination"];

const UNAVAILABLE_COPY: Readonly<Record<EntryDestination, string>> = {
  S05A: "「修改這個 App」目前還不能使用，這個 App 不會被更改。",
  S05B: "「改成我的版本」目前還不能使用，這個 App 不會被更改。",
  O01: "「分享」目前還不能使用，你的 App 和目前的結果都還在。",
  O02: "「調整結果」目前還不能使用，你的 App 和目前的結果都還在。"
};

/** S05-origin Inspection Mode: S03 only presents the return path; the S05 session itself stays with its owner. */
export interface InspectionContext {
  readonly origin: "COMPOSER" | "PREVIEW";
  readonly onReturn: () => void;
}

type AppSurfaceProps = {
  readonly session: AppSession;
  readonly onHome: () => void;
  readonly onEntry: (entry: AppSurfaceEntry) => EntryHandoff;
  readonly onPublish?:()=>Promise<string|null>;
  readonly inspection?: InspectionContext;
};

/** Bound to the App version it was raised on, so it never outlives that App. */
type UnavailableNotice = { readonly destination: EntryDestination; readonly sequence: number; readonly contentHash: string };

const RETURN_COPY = {
  COMPOSER: { full: "返回修改畫面", short: "返回修改" },
  PREVIEW: { full: "返回新版預覽", short: "返回預覽" }
} as const;

const CHANGE_LABELS: Readonly<Record<ChangeChoice, string>> = { MODIFY_THIS_APP: "修改這個 App", MAKE_MY_VERSION: "改成我的版本" };

function useCommitted(app: RuntimeAppHandle): number {
  const subscribe = useMemo(() => (onChange: () => void) => app.subscribeCommits(onChange), [app]);
  return useSyncExternalStore(subscribe, app.committedSequence);
}

/** F03 renders the Generated App into this container; the Shell never renders or dispatches App controls itself. */
function GeneratedApp({ app }: { readonly app: RuntimeAppHandle }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    return container === null ? undefined : app.mount(container);
  }, [app]);
  return <div className="s03-app" ref={containerRef} />;
}

/** S03 §8: only AVAILABLE canonical outputs are shown; ERROR outputs never get a value. */
function ResultSurface({ app, onCorrection }: { readonly app: RuntimeAppHandle; readonly onCorrection: () => void }) {
  useCommitted(app);
  const available = app.result().filter((output): output is Extract<RuntimeResultView, { status: "AVAILABLE" }> => output.status === "AVAILABLE");
  if (available.length === 0) return null;
  return (
    <section className="s03-result" aria-labelledby="s03-result-title">
      <h2 id="s03-result-title" className="s03-result-title">
        結果
      </h2>
      <dl className="s03-result-list" aria-live="polite">
        {available.map((output) => (
          <div key={output.id} className="s03-result-item">
            <dt>{output.label}</dt>
            <dd>{output.display}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="btn btn-secondary s03-result-action" onClick={onCorrection}>
        調整結果
      </button>
    </section>
  );
}

function OverflowMenu({ onHome, disabled }: { readonly onHome: () => void; readonly disabled: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="s03-overflow">
      <button
        type="button"
        className="s03-icon-button"
        aria-label="更多選項"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open ? (
        <ul className="s03-overflow-menu" role="menu" onKeyDown={(event) => event.key === "Escape" && setOpen(false)}>
          <li role="none">
            <button type="button" role="menuitem" className="s03-menu-item" onClick={onHome}>
              回到首頁 / 建立新的 App
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/** Mobile 「修改」 launcher (S03 Step 1): the User must pick one of two explicit paths; it never opens S05 itself. */
function ChangeSheet({ onChoose, onClose }: { readonly onChoose: (choice: ChangeChoice) => void; readonly onClose: () => void }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => firstRef.current?.focus(), []);
  return (
    <div className="s03-sheet-backdrop" onClick={onClose}>
      <div
        className="s03-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="s03-sheet-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.key === "Escape" && onClose()}
      >
        <h2 id="s03-sheet-title" className="s03-sheet-title">
          你想怎麼改？
        </h2>
        <button ref={firstRef} type="button" className="s03-sheet-option" onClick={() => onChoose("MODIFY_THIS_APP")}>
          {CHANGE_LABELS.MODIFY_THIS_APP}
        </button>
        <button type="button" className="s03-sheet-option" onClick={() => onChoose("MAKE_MY_VERSION")}>
          {CHANGE_LABELS.MAKE_MY_VERSION}
        </button>
        <button type="button" className="btn btn-secondary s03-sheet-cancel" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}

/** Polite, non-modal feedback for an entry no owner could take; it sits beside the App and never covers it. */
function EntryNotice({ notice, onDismiss }: { readonly notice: UnavailableNotice | null; readonly onDismiss: () => void }) {
  return (
    <div className="s03-notice-region" role="status" aria-live="polite">
      {notice === null ? null : (
        <div key={notice.sequence} className="s03-notice" data-entry-destination={notice.destination}>
          <p className="s03-notice-text">{UNAVAILABLE_COPY[notice.destination]}</p>
          <button type="button" className="btn btn-link s03-notice-dismiss" onClick={onDismiss}>
            知道了
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * S03 APP surface: minimal appf2 Shell chrome around the Generated App, which stays the primary content. The Shell
 * hands Share / Modify / Remix / Correction to their owners and never mutates the Runtime or its Blueprint; an entry
 * whose owner is unavailable is answered in place and leaves the App, its result and the focused control as they are.
 */
// eslint-disable-next-line complexity, max-lines-per-function -- Actual F03 controls and explicit F05 consent must keep the same App owner/session boundary.
export function AppSurface({ session, onHome, onEntry, onPublish, inspection }: AppSurfaceProps) {
  const { current } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { app, contentHash } = current;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState<UnavailableNotice | null>(null);
  const [publishOpen,setPublishOpen]=useState(false);
  const [correctionOpen,setCorrectionOpen]=useState(false);
  const [publishing,setPublishing]=useState(false);
  const [publishedUrl,setPublishedUrl]=useState<string|null>(null);
  const [publishFailed,setPublishFailed]=useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const modifyRef = useRef<HTMLButtonElement>(null);
  const [presenter, setPresenter] = useState<RuntimeProcessingPresenter | null>(null);
  const { title } = app;

  useEffect(() => {
    const next = new RuntimeProcessingPresenter(app);
    setPresenter(next);
    return () => next.dispose();
  }, [app]);
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [contentHash]);

  const sheetWasOpen = useRef(false);
  useEffect(() => {
    if (!sheetOpen && sheetWasOpen.current) modifyRef.current?.focus();
    sheetWasOpen.current = sheetOpen;
  }, [sheetOpen]);

  const enter = (entry: AppSurfaceEntry): void => {
    if(entry.destination==="O01"&&onPublish!==undefined){setPublishOpen(true);setPublishFailed(false);return;}
    if(entry.destination==="O02"&&inspection===undefined){setCorrectionOpen(true);setNotice(null);return;}
    const handoff = onEntry(entry);
    setNotice((previous) =>
      handoff === "UNAVAILABLE" ? { destination: entry.destination, sequence: (previous?.sequence ?? 0) + 1, contentHash } : null
    );
  };
  /** Find a real user-editable F03 input. No direct Result/Blueprint mutation. */
  const editInputs=():boolean=>{
    const node=mainRef.current?.querySelector<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(
      '.s03-app input:not([type="hidden"]):not(:disabled):not([readonly]), '+
      '.s03-app textarea:not(:disabled):not([readonly]), .s03-app select:not(:disabled)'
    );
    if(node===undefined||node===null)return false;
    setCorrectionOpen(false);
    globalThis.requestAnimationFrame(()=>{
      node.scrollIntoView({block:"center",behavior:"instant"});
      node.focus({preventScroll:true});
    });
    return true;
  };
  const confirmPublish=async():Promise<void>=>{
    if(onPublish===undefined||publishing)return;
    setPublishing(true);
    const url=await onPublish();
    setPublishing(false);
    if(url===null){setPublishFailed(true);return;}
    setPublishedUrl(url);setPublishOpen(false);
  };
  const visibleNotice = notice?.contentHash === contentHash ? notice : null;
  const choose = (choice: ChangeChoice): void => {
    setSheetOpen(false);
    enter(changeEntryFor(choice, contentHash));
  };
  const closeSheet = (): void => setSheetOpen(false);
  const returnCopy = inspection === undefined ? null : RETURN_COPY[inspection.origin];

  return (
    <div className={visibleNotice === null ? "s03" : "s03 s03-with-notice"}>
      <header className="s03-header" inert={sheetOpen||correctionOpen}>
        <button type="button" className="s03-home" aria-label="回到首頁" onClick={onHome}>
          <Brand />
        </button>
        <span className="s03-divider" aria-hidden="true" />
        <p className="s03-title">{title}</p>
        <div className="s03-actions">
          {inspection === undefined ? (
            <>
              <button type="button" className="btn btn-secondary s03-action s03-desktop-only" onClick={() => choose("MODIFY_THIS_APP")}>
                {CHANGE_LABELS.MODIFY_THIS_APP}
              </button>
              <button type="button" className="btn btn-ghost s03-action s03-desktop-only" onClick={() => choose("MAKE_MY_VERSION")}>
                {CHANGE_LABELS.MAKE_MY_VERSION}
              </button>
            </>
          ) : null}
          <button type="button" className="btn btn-primary s03-action s03-desktop-only" onClick={() => enter({ destination: "O01" })}>
            分享
          </button>
          <OverflowMenu onHome={onHome} disabled={sheetOpen} />
        </div>
      </header>
      {inspection !== undefined && returnCopy !== null ? (
        <div className="s03-inspection" role="region" aria-label="正在查看原版" inert={sheetOpen}>
          <p className="s03-inspection-label">正在查看原版</p>
          <button type="button" className="btn btn-link s03-inspection-return" onClick={inspection.onReturn}>
            {returnCopy.full}
          </button>
        </div>
      ) : null}
      <main className="s03-main" ref={mainRef} tabIndex={-1} aria-label={title} inert={sheetOpen||correctionOpen}>
        <div className="s03-processing">{presenter === null ? null : <RuntimeProcessingLayer presenter={presenter} />}</div>
        <GeneratedApp app={app} />
        <ResultSurface app={app} onCorrection={() => enter({ destination: "O02" })} />
      </main>
      <nav className="s03-bottom-nav" aria-label="App 導覽" inert={sheetOpen||correctionOpen}>
        <ul className="s03-bottom-list">
          <li>
            <button type="button" className="s03-nav-item is-active" aria-current="page">
              目前 App
            </button>
          </li>
          <li>
            {inspection !== undefined && returnCopy !== null ? (
              <button type="button" className="s03-nav-item" onClick={inspection.onReturn}>
                {returnCopy.short}
              </button>
            ) : (
              <button ref={modifyRef} type="button" className="s03-nav-item" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
                修改
              </button>
            )}
          </li>
          <li>
            <button type="button" className="s03-nav-item" onClick={() => enter({ destination: "O01" })}>
              分享
            </button>
          </li>
        </ul>
      </nav>
      <div className="s03-notice-host" inert={sheetOpen}>
        <EntryNotice notice={visibleNotice} onDismiss={() => setNotice(null)} />
      </div>
      {publishedUrl!==null?<section className="s03-notice" role="status" aria-label="公開分享連結">
        <p>已公開！其他人可直接使用，不需再次產生 AI。</p>
        <a href={publishedUrl}>{publishedUrl}</a>
        <button type="button" className="btn btn-secondary" onClick={()=>setPublishedUrl(null)}>關閉</button>
      </section>:null}
      {publishOpen?<div className="s03-sheet-backdrop">
        <div className="s03-sheet" role="dialog" aria-modal="true" aria-labelledby="publish-title">
          <h2 id="publish-title">公開分享這個 App？</h2>
          <p>公開的是 App 設計與初始資料，任何人都能從首頁直接使用。你的個人操作紀錄不會分享。請確認設計裡沒有私人資料。</p>
          {publishFailed?<p role="alert">發布失敗或沒有原作者權限；未公開，也沒有再次呼叫 AI。</p>:null}
          <button type="button" className="btn btn-primary" disabled={publishing} onClick={()=>{void confirmPublish();}}>
            {publishing?"正在核對原作者授權…":"確認公開（不使用 AI）"}
          </button>
          <button type="button" className="btn btn-secondary" disabled={publishing} onClick={()=>setPublishOpen(false)}>取消</button>
        </div>
      </div>:null}
      {correctionOpen?<ResultCorrectionDialog app={app} onClose={()=>setCorrectionOpen(false)} onEditInputs={editInputs}/>:null}
      {sheetOpen ? <ChangeSheet onChoose={choose} onClose={closeSheet} /> : null}
    </div>
  );
}
