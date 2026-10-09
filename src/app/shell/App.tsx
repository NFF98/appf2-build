import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { CreateWorkspace } from "../create/CreateWorkspace.js";
import type { CreationController } from "../create/creation-controller.js";
import { DiscoverScreen, type ComposerDraft } from "../discover/DiscoverScreen.js";
import type { PromptDraftStore } from "../discover/prompt-draft-store.js";

type Surface = "DISCOVER" | "CREATE";

const CREATE_HISTORY_STATE = "appf2-create";
const EMPTY_DRAFT: ComposerDraft = { text: "", capsuleId: null };

type AppProps = {
  readonly controller: CreationController;
  readonly drafts: PromptDraftStore;
};

/**
 * F00-STATE-001 Surface (DISCOVER → CREATE). The prompt draft lives here so S01 ↔ S02 never loses it; Back is
 * non-destructive (F00-UX-021): leaving S02 stops waiting locally and returns the current Intent to the Composer.
 * Only User edits of the Composer are persisted locally; F01 accepting the Intent ends the local draft.
 */
export function App({ controller, drafts }: AppProps) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [surface, setSurface] = useState<Surface>("DISCOVER");
  const [draft, setDraft] = useState<ComposerDraft>(() => drafts.load() ?? EMPTY_DRAFT);
  const acceptedIntent = session !== null && session.decision !== null ? session.rawIntent : null;

  useEffect(() => {
    if (acceptedIntent !== null) drafts.clearSubmitted(acceptedIntent);
  }, [acceptedIntent, drafts]);

  const returnToDiscover = useCallback(() => {
    controller.leave();
    const current = controller.getSnapshot();
    if (current !== null) setDraft({ text: current.rawIntent, capsuleId: current.capsuleId });
    setSurface("DISCOVER");
  }, [controller]);

  useEffect(() => {
    const onPopState = (): void => {
      const current = controller.getSnapshot();
      if (window.history.state !== CREATE_HISTORY_STATE) returnToDiscover();
      else if (current !== null && controller.start(current.rawIntent, current.capsuleId) === "RESUMED") setSurface("CREATE");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [controller, returnToDiscover]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [surface]);

  const changeDraft = (next: ComposerDraft): void => {
    setDraft(next);
    drafts.save(next);
  };

  const create = (): void => {
    if (controller.start(draft.text, draft.capsuleId) === "IGNORED") return;
    window.history.pushState(CREATE_HISTORY_STATE, "");
    setSurface("CREATE");
  };

  const back = (): void => {
    if (window.history.state === CREATE_HISTORY_STATE) window.history.back();
    else returnToDiscover();
  };

  if (surface === "CREATE" && session !== null) return <CreateWorkspace session={session} controller={controller} onBack={back} />;
  return <DiscoverScreen draft={draft} onDraftChange={changeDraft} onCreate={create} />;
}
