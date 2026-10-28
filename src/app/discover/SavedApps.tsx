import type { Ref } from "react";
import type { SavedTabApp, TabAppTarget } from "../shell/tab-app-recovery.js";

type SavedAppsProps = {
  readonly headingRef: Ref<HTMLHeadingElement>;
  readonly apps: readonly SavedTabApp[];
  readonly onOpen: (target: TabAppTarget) => void;
  readonly onForget: (target: TabAppTarget) => void;
};

/** Real already-hydrated apps in THIS tab, not Inspiration prompts or a public gallery. */
export function SavedApps({ headingRef, apps, onOpen, onForget }: SavedAppsProps) {
  return (
    <section id="saved-apps" className="saved-apps" aria-labelledby="saved-apps-title">
      <h2 id="saved-apps-title" className="inspiration-title" tabIndex={-1} ref={headingRef}>我的 App（本瀏覽器）</h2>
      <p className="saved-apps-note">已成功建立的 App 可直接重開，無需再次使用 AI。只保留在這台裝置的同一瀏覽器中，最長 24 小時（包含其他分頁）；過期或權限失效時不能重開。</p>
      {apps.length===0 ? (
        <p className="saved-apps-empty">目前沒有可重開的 App。先建立一次，成功後就會出現在這裡。</p>
      ) : (
        <ul className="saved-apps-grid">
          {apps.map(app => (
            <li className="saved-app-card" key={app.intentId+":"+app.contentHash}>
              <h3 className="capsule-title">{app.title}</h3>
              <p className="saved-apps-note">原版直接開啟 · 不重新產生</p>
              <div className="saved-app-actions">
                <button type="button" className="btn btn-primary" onClick={() => onOpen(app)}
                  aria-label={`免費重開：${app.title}`}>開啟 App（不使用 AI）</button>
                <button type="button" className="btn btn-ghost" onClick={() => onForget(app)}
                  aria-label={`從清單移除：${app.title}`}>從清單移除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
