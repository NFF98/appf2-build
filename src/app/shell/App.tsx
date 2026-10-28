import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { AppSession } from "../app-surface/app-session.js";
import { AppSurface, type AppSurfaceEntry, type EntryHandoff } from "../app-surface/AppSurface.js";
import { ChangeSessionOwner } from "../change/change-session.js";
import { ChangeWorkspace } from "../change/ChangeWorkspace.js";
import { CreateWorkspace } from "../create/CreateWorkspace.js";
import type { CreationController } from "../create/creation-controller.js";
import type { CreationSession } from "../create/creation-session.js";
import { DiscoverScreen, type ComposerDraft } from "../discover/DiscoverScreen.js";
import type { PromptDraftStore } from "../discover/prompt-draft-store.js";
import { isRetryableLaunchFailure, type AppLauncher, type LaunchState } from "../runtime/app-launcher.js";
import { clearTabAppTarget, forgetSavedTabApp, readSavedTabApps, readTabAppTarget, rememberSavedTabApp, saveTabAppTarget, type TabAppTarget } from "./tab-app-recovery.js";

type Surface = "DISCOVER" | "CREATE";

const CREATE_HISTORY_STATE = "appf2-create";
const EMPTY_DRAFT: ComposerDraft = { text: "", capsuleId: null };
function shareFromPath():string|null{
  const match=/^\/share\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/iu.exec(window.location.pathname);
  return match?.[1]??null;
}

type AppProps = {
  readonly controller: CreationController;
  readonly drafts: PromptDraftStore;
  readonly launcher: AppLauncher;
};

/**
 * APP surface stage: S03, or the one S05 change session the User opened from it. S05A / S05B choices go to the F00
 * change-session owner; O01 Share (F05) and O02 Correction (F16) have no owner in this build, so S03 reports them
 * unavailable in place. While the session inspects the original, S03 runs in Inspection Mode and returns to it.
 */
function AppStage({ session, onHome }: { readonly session: AppSession; readonly onHome: () => void }) {
  const [changes] = useState(() => new ChangeSessionOwner());
  const change = useSyncExternalStore(changes.subscribe, changes.getSnapshot);
  const { current } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const onEntry = useCallback((entry: AppSurfaceEntry): EntryHandoff => ("choice" in entry && changes.open(entry) ? "HANDED_OFF" : "UNAVAILABLE"), [changes]);

  if (change === null) return <AppSurface session={session} onHome={onHome} onEntry={onEntry} />;
  if (change.view === "COMPOSER") return <ChangeWorkspace change={change} owner={changes} appTitle={current.app.title} />;
  return <AppSurface session={session} onHome={onHome} onEntry={onEntry} inspection={{ origin: "COMPOSER", onReturn: changes.returnFromOriginal }} />;
}

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
// eslint-disable-next-line complexity -- Restore/auth state and strict tab-target guards must all fail closed.
export function App({ controller, drafts, launcher }: AppProps) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const launch = useSyncExternalStore(launcher.subscribe, launcher.getSnapshot);
  const [publicShareId,setPublicShareId]=useState<string|null>(shareFromPath);
  const [restoredTarget, setRestoredTarget] = useState<ValidatedTarget | null>(()=>shareFromPath()===null?readTabAppTarget():null);
  const [surface, setSurface] = useState<Surface>(()=>shareFromPath()===null&&readTabAppTarget()===null?"DISCOVER":"CREATE");
  const [draft, setDraft] = useState<ComposerDraft>(() => drafts.load() ?? EMPTY_DRAFT);
  const [savedApps, setSavedApps] = useState(() => readSavedTabApps());
  // A second tab can save/forget Apps without making the open tab lose its card list.
  useEffect(() => {
    const refresh = (event: StorageEvent): void => {
      if (event.storageArea === globalThis.localStorage && event.key === "appf2.tab.saved-apps.v1")
        setSavedApps(readSavedTabApps());
    };
    window.addEventListener("storage",refresh);
    return () => window.removeEventListener("storage",refresh);
  }, []);
  const acceptedIntent = session !== null && session.decision !== null ? session.rawIntent : null;
  const validatedFromCreation = validatedTarget(session);
  // Explicit card selection overrides a prior creation session; a fresh Create clears it.
  const validated = restoredTarget ?? validatedFromCreation;
  const validatedHash = validated?.contentHash ?? null;
  const validatedIntentId = validated?.intentId ?? null;
  const appSession = useMemo(
    () => (launch.kind === "READY" ? new AppSession({ contentHash: launch.contentHash, app: launch.app }) : null),
    [launch]
  );
  const showingApp = surface==="CREATE"&&launch.kind==="READY"&&appSession!==null&&
    (publicShareId!==null||launch.contentHash===validatedHash);

  useEffect(() => {
    if (acceptedIntent !== null) drafts.clearSubmitted(acceptedIntent);
  }, [acceptedIntent, drafts]);

  useEffect(() => {
    if (validatedFromCreation !== null && restoredTarget === null) saveTabAppTarget(validatedFromCreation);
  }, [validatedFromCreation?.contentHash, validatedFromCreation?.intentId, restoredTarget]);

  // Only a successfully hydrated F03 handle earns a reusable card (not merely F01/F02).
  useEffect(() => {
    if (surface !== "CREATE" || launch.kind !== "READY" || launch.contentHash !== validatedHash || validatedIntentId === null) return;
    setSavedApps(rememberSavedTabApp({intentId:validatedIntentId,contentHash:launch.contentHash},launch.app.title));
  }, [surface, launch, validatedHash, validatedIntentId]);

  useEffect(() => {
    if(surface!=="CREATE")return;
    if(publicShareId!==null)launcher.launchShared(publicShareId);
    else if(validatedIntentId!==null&&validatedHash!==null)launcher.launch(validatedIntentId,validatedHash);
  },[launcher,surface,publicShareId,validatedHash,validatedIntentId]);

  const returnToDiscover = useCallback(() => {
    clearTabAppTarget();
    setPublicShareId(null);
    if(window.location.pathname.startsWith("/share/"))window.history.replaceState(null,"","/");
    setRestoredTarget(null);
    launcher.reset();
    controller.leave();
    const current = controller.getSnapshot();
    if (current !== null) setDraft({ text: current.rawIntent, capsuleId: current.capsuleId });
    setSurface("DISCOVER");
  }, [controller, launcher]);

  useEffect(() => {
    const onPopState = (): void => {
      const current = controller.getSnapshot();
      const shared=shareFromPath();
      if(shared!==null){setPublicShareId(shared);setRestoredTarget(null);setSurface("CREATE");}
      else if (window.history.state !== CREATE_HISTORY_STATE) returnToDiscover();
      else {
        // History navigation to an existing compiled App must NEVER re-run F01.
        const target=readTabAppTarget();
        if(target!==null){setRestoredTarget(target);setSurface("CREATE");}
        else if(current!==null && controller.start(current.rawIntent,current.capsuleId)==="RESUMED")setSurface("CREATE");
      }
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
    setPublicShareId(null);
    setRestoredTarget(null);
    launcher.reset();
    window.history.pushState(CREATE_HISTORY_STATE, "");
    setSurface("CREATE");
  };

  /** Read-only authenticated delivery + F03 hydration; intentionally NO F01 or model call. */
  const openSaved = (target: TabAppTarget): void => {
    if (!readSavedTabApps().some(app => app.intentId===target.intentId && app.contentHash===target.contentHash)) return;
    controller.leave();
    launcher.reset();
    setRestoredTarget(target);
    saveTabAppTarget(target);
    window.history.pushState(CREATE_HISTORY_STATE, "");
    setSurface("CREATE");
  };

  const openPublic=(shareId:string):void=>{
    controller.leave();launcher.reset();
    clearTabAppTarget();setRestoredTarget(null);
    setPublicShareId(shareId);
    window.history.pushState(CREATE_HISTORY_STATE,"","/share/"+encodeURIComponent(shareId));
    setSurface("CREATE");
  };

  const forgetSaved = (target: TabAppTarget): void => {
    setSavedApps(forgetSavedTabApp(target));
  };

  const back = (): void => {
    if (publicShareId!==null)return returnToDiscover();
    if (window.history.state === CREATE_HISTORY_STATE) window.history.back();
    else returnToDiscover();
  };

  if (showingApp) return <AppStage key={launch.contentHash} session={appSession} onHome={back} />;
  if (surface === "CREATE" && (restoredTarget !== null || publicShareId!==null)) {
    return (
      <main className="app-recovery" role="status">
        <p>{launch.kind === "FAILED" ? "先前的 App 無法安全恢復。" : "正在安全恢復先前的 App…"}</p>
        {launch.kind === "FAILED" && <button type="button" onClick={returnToDiscover}>返回首頁</button>}
      </main>
    );
  }
  if (surface === "CREATE" && session !== null) {
    return (
      <CreateWorkspace session={session} controller={controller} onBack={back} {...workspaceLaunchProps(launch, validatedHash, launcher)} />
    );
  }
  return <DiscoverScreen draft={draft} onDraftChange={changeDraft} onCreate={create}
    savedApps={savedApps} onOpenSaved={openSaved} onForgetSaved={forgetSaved} onOpenPublic={openPublic} />;
}
