import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RuntimeProcessingLayer } from "../../../../src/app/runtime/RuntimeProcessingLayer.js";
import { RuntimeProcessingPresenter, type RuntimeProcessingView } from "../../../../src/app/runtime/runtime-processing.js";
import type { OperationListener, RuntimeOperationProjection } from "../../../../src/platform/runtime/runtime-operation.js";

/**
 * Test-only page: the production F00 presenter + O05 S03 layer, fed by a transparent relay of real F03
 * RuntimeOperation projections produced by a Node-side Runtime Instance. The relay delivers each projection
 * unchanged and in F03 order; it owns no operation, checkpoint or commit logic.
 */
export type RuntimeProcessingHarnessApi = {
  readonly log: RuntimeProcessingView[];
  deliver(projections: readonly RuntimeOperationProjection[]): void;
  layerInsertions(): number;
};

declare global {
  interface Window {
    appf2RuntimePress?: (nodeId: string) => Promise<RuntimeOperationProjection[]>;
    appf2RuntimeHarness?: RuntimeProcessingHarnessApi;
  }
}

const listeners = new Set<OperationListener>();
const presenter = new RuntimeProcessingPresenter({
  subscribeOperations: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
});
const log: RuntimeProcessingView[] = [];
presenter.subscribe(() => log.push(presenter.getSnapshot()));

let insertions = 0;
const isLayer = (node: Node): boolean => node instanceof HTMLElement && (node.matches(".runtime-processing") || node.querySelector(".runtime-processing") !== null);
new MutationObserver((records) => {
  for (const record of records) insertions += [...record.addedNodes].filter(isLayer).length;
}).observe(document.body, { childList: true, subtree: true });

function deliver(projections: readonly RuntimeOperationProjection[]): void {
  for (const projection of projections) {
    for (const listener of [...listeners]) listener(projection);
  }
}

window.appf2RuntimeHarness = { log, deliver, layerInsertions: () => insertions };

function GeneratedAppFrame() {
  const press = async (): Promise<void> => {
    const projections = (await window.appf2RuntimePress?.("node_go")) ?? [];
    deliver(projections);
  };
  return (
    <main className="s02-main">
      <h1>聚餐計分板</h1>
      <RuntimeProcessingLayer presenter={presenter} />
      <button type="button" className="btn btn-primary" onClick={() => void press()}>
        加一分
      </button>
    </main>
  );
}

const root = document.getElementById("root");
if (root === null) throw new Error("harness root element is missing");
createRoot(root).render(
  <StrictMode>
    <GeneratedAppFrame />
  </StrictMode>
);
