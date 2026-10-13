import { useEffect, useId, useRef, useState } from "react";

import type { ChangeEntry } from "../app-surface/app-session.js";
import type { ChangeSession, ChangeSessionOwner } from "./change-session.js";

const PATH_TITLE: Readonly<Record<ChangeEntry["destination"], string>> = { S05A: "修改這個 App", S05B: "改成我的版本" };
const PATH_DETAIL: Readonly<Record<ChangeEntry["destination"], string | null>> = { S05A: null, S05B: "拿這個 App 當底稿，改成你要的版本" };
const CONTINUE_UNAVAILABLE = "「開始修改」目前還不能使用，你寫的修改內容和原版都還在。";

type ChangeWorkspaceProps = {
  readonly change: ChangeSession;
  readonly owner: ChangeSessionOwner;
  readonly appTitle: string;
};

/**
 * S05A / S05B Change Composer. Producing a new version belongs to F06, which is not part of this build, so 「開始修改」
 * says so in place and keeps the draft; nothing here generates, previews or adopts a version.
 */
export function ChangeWorkspace({ change, owner, appTitle }: ChangeWorkspaceProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const inputId = useId();
  const [continueUnavailable, setContinueUnavailable] = useState(false);
  const { destination } = change.entry;
  const detail = PATH_DETAIL[destination];

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div className="s05" data-change-path={destination} data-change-session={change.id}>
      <header className="s05-header">
        <button type="button" className="btn btn-link back-link" onClick={owner.close}>
          <span aria-hidden="true">‹ </span>回原 App
        </button>
        <p className="s05-app-title">{appTitle}</p>
      </header>
      <main className="s05-main">
        <h1 ref={titleRef} className="s05-title" tabIndex={-1}>
          {PATH_TITLE[destination]}
        </h1>
        {detail === null ? null : <p className="s05-detail">{detail}</p>}
        <div className="s05-composer">
          <label className="field-label" htmlFor={inputId}>
            你想怎麼改？
          </label>
          <textarea id={inputId} className="s05-input" value={change.draft} onChange={(event) => owner.updateDraft(event.target.value)} />
        </div>
        <div className="s05-original">
          <p className="s05-original-note">原版會保留</p>
          <button type="button" className="btn btn-ghost" onClick={owner.viewOriginal}>
            查看原版<span aria-hidden="true"> →</span>
          </button>
        </div>
        <button type="button" className="btn btn-primary s05-continue" onClick={() => setContinueUnavailable(true)}>
          開始修改
        </button>
        <div className="s05-notice-region" role="status" aria-live="polite">
          {continueUnavailable ? <p className="s05-notice">{CONTINUE_UNAVAILABLE}</p> : null}
        </div>
      </main>
    </div>
  );
}
