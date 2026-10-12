import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { RuntimeAppHandle, RuntimeResultView } from "../../platform/runtime/runtime-operation.js";
import { RuntimeProcessingPresenter } from "../runtime/runtime-processing.js";
import { RuntimeProcessingLayer } from "../runtime/RuntimeProcessingLayer.js";
import { Brand } from "../shell/Brand.js";
import { changeEntryFor, type AppSession, type ChangeChoice, type ChangeEntry } from "./app-session.js";

/** S03 entries handed to their owning surfaces (S05A / S05B, O01 Share, O02 Correction). */
export type AppSurfaceEntry = ChangeEntry | { readonly destination: "O01" } | { readonly destination: "O02" };

/** S05-origin Inspection Mode: S03 only presents the return path; the S05 session itself stays with its owner. */
export interface InspectionContext {
  readonly origin: "COMPOSER" | "PREVIEW";
  readonly onReturn: () => void;
}

type AppSurfaceProps = {
  readonly session: AppSession;
  readonly onHome: () => void;
  readonly onEntry: (entry: AppSurfaceEntry) => void;
  readonly inspection?: InspectionContext;
};

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

/**
 * S03 APP surface: minimal appf2 Shell chrome around the Generated App, which stays the primary content. The Shell
 * hands Share / Modify / Remix / Correction to their owners and never mutates the Runtime or its Blueprint.
 */
export function AppSurface({ session, onHome, onEntry, inspection }: AppSurfaceProps) {
  const { current } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { app, contentHash } = current;
  const [sheetOpen, setSheetOpen] = useState(false);
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

  const choose = (choice: ChangeChoice): void => {
    setSheetOpen(false);
    onEntry(changeEntryFor(choice, contentHash));
  };
  const closeSheet = (): void => setSheetOpen(false);
  const returnCopy = inspection === undefined ? null : RETURN_COPY[inspection.origin];

  return (
    <div className="s03">
      <header className="s03-header" inert={sheetOpen}>
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
          <button type="button" className="btn btn-primary s03-action s03-desktop-only" onClick={() => onEntry({ destination: "O01" })}>
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
      <main className="s03-main" ref={mainRef} tabIndex={-1} aria-label={title} inert={sheetOpen}>
        <div className="s03-processing">{presenter === null ? null : <RuntimeProcessingLayer presenter={presenter} />}</div>
        <GeneratedApp app={app} />
        <ResultSurface app={app} onCorrection={() => onEntry({ destination: "O02" })} />
      </main>
      <nav className="s03-bottom-nav" aria-label="App 導覽" inert={sheetOpen}>
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
            <button type="button" className="s03-nav-item" onClick={() => onEntry({ destination: "O01" })}>
              分享
            </button>
          </li>
        </ul>
      </nav>
      {sheetOpen ? <ChangeSheet onChoose={choose} onClose={closeSheet} /> : null}
    </div>
  );
}
