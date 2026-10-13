import { createRoot } from "react-dom/client";

import { evaluateResult } from "../result-evaluation.js";
import type { RuntimeInstance } from "../runtime-instance.js";
import type { RuntimeAppHandle, RuntimeAppHost, RuntimeResultView } from "../runtime-operation.js";
import { createBrowserRuntime } from "./browser-runtime.js";
import { displayValue } from "./display-value.js";
import { RuntimeFrame } from "./RuntimeFrame.js";

function resultViews(runtime: RuntimeInstance): readonly RuntimeResultView[] {
  return (evaluateResult(runtime)?.outputs ?? []).map((output): RuntimeResultView => {
    const base = { id: output.id, label: output.label, sensitivity: output.sensitivity };
    return output.status === "AVAILABLE" ? { ...base, status: "AVAILABLE", display: displayValue(output.value) } : { ...base, status: "ERROR" };
  });
}

/** The Shell-facing handle of one READY Instance (F00-AC-020): read projections, render into a container, release. */
export function runtimeAppHandle(runtime: RuntimeInstance, contentHash: string): RuntimeAppHandle {
  return Object.freeze({
    contentHash,
    title: runtime.blueprint?.meta.title ?? "",
    subscribeOperations: (listener) => runtime.subscribeOperations(listener),
    subscribeCommits: (listener) => runtime.subscribe(() => listener()),
    committedSequence: () => runtime.actionSequence,
    result: () => resultViews(runtime),
    mount: (container) => {
      const root = createRoot(container);
      root.render(<RuntimeFrame runtime={runtime} />);
      // The host root may be mid-commit when it releases this container; unmount once that work has finished.
      return () => queueMicrotask(() => root.unmount());
    },
    release: () => runtime.dispose()
  } satisfies RuntimeAppHandle);
}

/** F03 browser host: one fresh Instance per delivered Blueprint; a non-READY hydration is disposed, never shown. */
export function createBrowserAppHost(): RuntimeAppHost {
  return {
    launch: async (delivery) => {
      const runtime = createBrowserRuntime(delivery);
      const hydrated = await runtime.hydrate();
      if (hydrated.status !== "READY") {
        runtime.dispose();
        return { ok: false, status: hydrated.status };
      }
      return { ok: true, app: runtimeAppHandle(runtime, delivery.admission.content_hash) };
    }
  };
}
