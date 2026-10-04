export type EvidenceLifecycleEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface EvidencePageLifecycleTargets {
  readonly window: EvidenceLifecycleEventTarget;
  readonly document: EvidenceLifecycleEventTarget & {
    readonly visibilityState: DocumentVisibilityState;
  };
}

export interface EvidencePageLifecycleFlusher {
  flush(): Promise<void>;
  flushOnPageHide(): void;
}

export function bindEvidencePageLifecycle(
  collector: EvidencePageLifecycleFlusher,
  targets: EvidencePageLifecycleTargets
): () => void {
  const onPageHide = (): void => {
    collector.flushOnPageHide();
  };
  const onVisibilityChange = (): void => {
    if (targets.document.visibilityState === "hidden") {
      void collector.flush();
    }
  };
  targets.window.addEventListener("pagehide", onPageHide);
  targets.document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    targets.window.removeEventListener("pagehide", onPageHide);
    targets.document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
