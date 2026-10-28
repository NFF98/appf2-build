import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createBrowserComposition, createBrowserPromptDraftStore } from "./shell/browser-composition.js";
import { App } from "./shell/App.js";

const root = document.getElementById("root");
if (root === null) throw new Error("appf2 shell root element is missing");

const { controller, launcher,publisher } = createBrowserComposition();

createRoot(root).render(
  <StrictMode>
    <App controller={controller} drafts={createBrowserPromptDraftStore()} launcher={launcher} publisher={publisher} />
  </StrictMode>
);
