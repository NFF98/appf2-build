import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { AppSession } from "../app-surface/app-session.js";
import { AppSurface, type EntryHandoff } from "../app-surface/AppSurface.js";
import { CreateWorkspace } from "../create/CreateWorkspace.js";
import type { CreationController } from "../create/creation-controller.js";
import type { CreationSession } from "../create/creation-session.js";
import { DiscoverScreen, type ComposerDraft } from "../discover/DiscoverScreen.js";
import type { PromptDraftStore } from "../discover/prompt-draft-store.js";
import { isRetryableLaunchFailure, type AppLauncher, type LaunchState } from "../runtime/app-launcher.js";

type Surface = "DISCOVER" | "CREATE";

const CREATE_HISTORY_STATE = "appf2-create";
const EMPTY_DRAFT: ComposerDraft = { text: "", capsuleId: null };

type AppProps = {
  readonly controller: CreationController;
  readonly drafts: PromptDraftStore;
  readonly launcher: AppLauncher;
};

/**
 * No owner of S05A / S05B (F06), O01 Share (F05) or O02 Correction (F16) is part of this build, so every S03 entry
 * is reported unavailable and S03 tells the User so in place, leaving the App as it is.
 */
const handOffUnavailable = (): EntryHandoff => "UNAVAILABLE";

type ValidatedTarget = { readonly intentId: string; readonly contentHash: string };

function validatedTarget(session: CreationSession | null): ValidatedTarget | null {
  if (session?.phase.kind !== "BUILD_VALIDATED" || session.decision === null) return null;
  return { intentId: session.decision.intentId, contentHash: session.phase.contentHash };
}

/** S02 only reflects the launch of the Blueprint it validated; a stale launch never leaks into it. */
function workspaceLaunchProps(launch: LaunchState, contentHash: string | null, launcher: AppLauncher) {
  if (launch.kind === "IDLE" || launch.contentHash !== contentHash) return {};
  if (launch.kind === "HYDRATING") return { runtimeStatus: "HYDRATING" as const };
  if (launch.kind !== "FAILED") return {};
  return { launchFailure: { onRetry: isRetryableLaunchFailure(launch.failure) ? () => launcher.retry() : null } };
}

/**
 * F00-STATE-001 Surface (DISCOVER → CREATE → APP). The prompt draft lives here so S01 ↔ S02 never loses it; Back is
 * non-destructive (F00-UX-021): leaving S02 stops waiting locally and returns the current Intent to the Composer.
 * Only User edits of the Composer are persisted locally; F01 accepting the Intent ends the local draft. The APP
 * surface only appears once the validated Blueprint has passed secure delivery, admission and F03 hydration.
 */
export function App({ controller, drafts, launcher }: AppProps) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const launch = useSyncExternalStore(launcher.subscribe, launcher.getSnapshot);
  const [surface, setSurface] = useState<Surface>("DISCOVER");
  const [draft, setDraft] = useState<ComposerDraft>(() => drafts.load() ?? EMPTY_DRAFT);
  const acceptedIntent = session !== null && session.decision !== null ? session.rawIntent : null;
  const validated = validatedTarget(session);
  const validatedHash = validated?.contentHash ?? null;
  const validatedIntentId = validated?.intentId ?? null;
  const appSession = useMemo(
    () => (launch.kind === "READY" ? new AppSession({ contentHash: launch.contentHash, app: launch.app }) : null),
    [launch]
  );
  const showingApp = surface === "CREATE" && launch.kind === "READY" && launch.contentHash === validatedHash && appSession !== null;

  useEffect(() => {
    if (acceptedIntent !== null) drafts.clearSubmitted(acceptedIntent);
  }, [acceptedIntent, drafts]);

  useEffect(() => {
    if (surface === "CREATE" && validatedIntentId !== null && validatedHash !== null) launcher.launch(validatedIntentId, validatedHash);
  }, [launcher, surface, validatedHash, validatedIntentId]);

  const returnToDiscover = useCallback(() => {
    launcher.reset();
    controller.leave();
    const current = controller.getSnapshot();
    if (current !== null) setDraft({ text: current.rawIntent, capsuleId: current.capsuleId });
    setSurface("DISCOVER");
  }, [controller, launcher]);

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
  }, [surface, showingApp]);

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

  if (showingApp) return <AppSurface session={appSession} onHome={back} onEntry={handOffUnavailable} />;
  if (surface === "CREATE" && session !== null) {
    return (
      <CreateWorkspace session={session} controller={controller} onBack={back} {...workspaceLaunchProps(launch, validatedHash, launcher)} />
    );
  }
  return <DiscoverScreen draft={draft} onDraftChange={changeDraft} onCreate={create} />;
}
