import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createBrowserCreationController, createBrowserPromptDraftStore } from "./shell/browser-composition.js";
import { App } from "./shell/App.js";

const root = document.getElementById("root");
if (root === null) throw new Error("appf2 shell root element is missing");

createRoot(root).render(
  <StrictMode>
    <App controller={createBrowserCreationController()} drafts={createBrowserPromptDraftStore()} />
  </StrictMode>
);
