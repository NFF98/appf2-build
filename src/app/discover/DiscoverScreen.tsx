import { useRef, useState } from "react";

import { Brand } from "../shell/Brand.js";
import type { Capsule } from "./capsules.js";
import { Composer } from "./Composer.js";
import { DiscoverNav } from "./DiscoverNav.js";
import { Inspiration } from "./Inspiration.js";
import { SavedApps } from "./SavedApps.js";
import { PublicApps } from "./PublicApps.js";
import {CodeBuilderPanel} from "../code-builder/CodeBuilderPanel.js";
import {AgentBuilderPanel} from "../code-builder/AgentBuilderPanel.js";
import type { SavedTabApp, TabAppTarget } from "../shell/tab-app-recovery.js";

export type ComposerDraft = {
  readonly text: string;
  /** Local origin marker of the last Capsule prefill; the editable text is always the User's. */
  readonly capsuleId: string | null;
};

type DiscoverScreenProps = {
  readonly draft: ComposerDraft;
  readonly onDraftChange: (draft: ComposerDraft) => void;
  readonly onCreate: () => void;
  readonly savedApps: readonly SavedTabApp[];
  readonly onOpenSaved: (target: TabAppTarget) => void;
  readonly onForgetSaved: (target: TabAppTarget) => void;
  readonly onOpenPublic:(shareId:string)=>void;
};

/** S01 Discover / Start: prompt-first Creator Canvas with supporting Inspiration Capsules; no registration gate. */
export function DiscoverScreen({ draft, onDraftChange, onCreate, savedApps, onOpenSaved, onForgetSaved,onOpenPublic }: DiscoverScreenProps) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const inspirationRef = useRef<HTMLHeadingElement>(null);
  const savedAppsRef = useRef<HTMLHeadingElement>(null);
  const [suggestedPrompt, setSuggestedPrompt] = useState<{ text: string; revision: number } | null>(null);

  const prefillLegacy = (capsule: Capsule): void => {
    onDraftChange({ text: capsule.prompt, capsuleId: capsule.id });
    composerRef.current?.focus({ preventScroll: true });
  };

  const prefill = (capsule: Capsule): void => {
    // Inspiration belongs to the current Code Builder, never silently to the legacy F01/F02 compiler.
    setSuggestedPrompt(previous => ({ text: capsule.prompt, revision: (previous?.revision ?? 0) + 1 }));
    const builder = document.getElementById("code-builder-prompt");
    builder?.focus({ preventScroll: true });
    builder?.scrollIntoView({ block: "center" });
  };

  const goHome = (): void => {
    window.scrollTo(0, 0);
    document.getElementById("code-builder-prompt")?.focus({ preventScroll: true });
  };

  const goInspiration = (): void => {
    inspirationRef.current?.scrollIntoView({ block: "start" });
    inspirationRef.current?.focus({ preventScroll: true });
  };

  const goSavedApps = (): void => {
    savedAppsRef.current?.scrollIntoView({ block: "start" });
    savedAppsRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="s01">
      <header className="s01-header">
        <Brand />
        <DiscoverNav variant="header" onHome={goHome} onExplore={goInspiration} onApps={goSavedApps} />
      </header>
      <main className="s01-main">
        <section className="s01-hero" aria-labelledby="s01-hero-title">
          <h1 id="s01-hero-title" className="s01-hero-title">
            意圖就是 <span className="s01-hero-accent">App</span>
          </h1>
        </section>
        <section className="code-builder-panel" aria-labelledby="free-app-reuse-title">
          <h2 id="free-app-reuse-title">零新費用：使用已發布 App</h2>
          <p className="saved-apps-note">直接開啟既有公開 App，不重新呼叫生成 AI、
            不使用 Cloudflare Containers。這不是新 App 的 AI 生成／雲端建置驗收。</p>
          <button className="btn btn-secondary" type="button" onClick={() => {
            document.getElementById("published-apps-title")
              ?.scrollIntoView({block:"start",behavior:"smooth"});
          }}>免費試用：已公開 App（不使用 AI）</button>
        </section>
        <AgentBuilderPanel suggestedPrompt={suggestedPrompt}/>
        <details className="legacy-composer">
          <summary>舊版單檔 Code Builder（只供相容）</summary>
          <CodeBuilderPanel suggestedPrompt={suggestedPrompt}
            onOpen={id=>globalThis.location.assign("/code/"+encodeURIComponent(id))}/>
        </details>
        <details className="legacy-composer">
          <summary>舊版 Blueprint Composer（相容模式，不適用於自由程式 App）</summary>
          <p className="saved-apps-note">這是舊版元件組合流程；十八啦等需要 AI 自由寫程式的需求，請使用上方 AI Code Builder。</p>
          <Composer ref={composerRef} draft={draft} onDraftChange={onDraftChange} onCreate={onCreate} onSuggestion={prefillLegacy} />
        </details>
        <SavedApps headingRef={savedAppsRef} apps={savedApps} onOpen={onOpenSaved} onForget={onForgetSaved} />
        <PublicApps onOpen={onOpenPublic} />
        <Inspiration headingRef={inspirationRef} onTry={prefill} />
      </main>
      <DiscoverNav variant="bottom" onHome={goHome} onExplore={goInspiration} onApps={goSavedApps} />
    </div>
  );
}
