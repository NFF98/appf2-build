import { createRoot } from "react-dom/client";

import { AppSession } from "../../../../src/app/app-surface/app-session.js";
import { AppSurface, type AppSurfaceEntry, type InspectionContext } from "../../../../src/app/app-surface/AppSurface.js";
import { createBrowserAppHost } from "../../../../src/platform/runtime/browser/runtime-app-host.js";
import type { RuntimeAppDelivery } from "../../../../src/platform/runtime/runtime-operation.js";

type SurfaceRecord = { entries: AppSurfaceEntry[]; returns: number; homes: number };

const record: SurfaceRecord = { entries: [], returns: 0, homes: 0 };
(window as unknown as { s03Harness: SurfaceRecord }).s03Harness = record;

async function mount(): Promise<void> {
  const admitted = (await (await fetch("/admitted.json", { cache: "no-store" })).json()) as RuntimeAppDelivery;
  const launched = await createBrowserAppHost().launch(admitted);
  if (!launched.ok) {
    document.body.dataset.hydration = launched.status;
    return;
  }
  const origin = new URLSearchParams(window.location.search).get("inspection");
  const inspection: InspectionContext | undefined =
    origin === "COMPOSER" || origin === "PREVIEW"
      ? {
          origin,
          onReturn: () => {
            record.returns += 1;
          }
        }
      : undefined;
  const root = document.getElementById("root");
  if (root === null) throw new Error("harness root element is missing");
  createRoot(root).render(
    <AppSurface
      session={new AppSession({ contentHash: admitted.admission.content_hash, app: launched.app })}
      onHome={() => {
        record.homes += 1;
      }}
      onEntry={(entry) => record.entries.push(entry)}
      {...(inspection === undefined ? {} : { inspection })}
    />
  );
  document.body.dataset.contentHash = admitted.admission.content_hash;
  document.body.dataset.hydration = "READY";
}

void mount();
