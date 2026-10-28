import { useRef } from "react";

import { Brand } from "../shell/Brand.js";
import type { Capsule } from "./capsules.js";
import { Composer } from "./Composer.js";
import { DiscoverNav } from "./DiscoverNav.js";
import { Inspiration } from "./Inspiration.js";
import { SavedApps } from "./SavedApps.js";
import { PublicApps } from "./PublicApps.js";
import {CodeBuilderPanel} from "../code-builder/CodeBuilderPanel.js";
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

  const prefill = (capsule: Capsule): void => {
    onDraftChange({ text: capsule.prompt, capsuleId: capsule.id });
    const composer = composerRef.current;
    composer?.focus({ preventScroll: true });
    composer?.scrollIntoView({ block: "center" });
  };

  const goHome = (): void => {
    window.scrollTo(0, 0);
    composerRef.current?.focus({ preventScroll: true });
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
        <CodeBuilderPanel onOpen={id=>globalThis.location.assign("/code/"+encodeURIComponent(id))}/>
        <Composer ref={composerRef} draft={draft} onDraftChange={onDraftChange} onCreate={onCreate} onSuggestion={prefill} />
        <SavedApps headingRef={savedAppsRef} apps={savedApps} onOpen={onOpenSaved} onForget={onForgetSaved} />
        <PublicApps onOpen={onOpenPublic} />
        <Inspiration headingRef={inspirationRef} onTry={prefill} />
      </main>
      <DiscoverNav variant="bottom" onHome={goHome} onExplore={goInspiration} onApps={goSavedApps} />
    </div>
  );
}
