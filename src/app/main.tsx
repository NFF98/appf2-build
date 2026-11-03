import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createBrowserComposition, createBrowserPromptDraftStore } from "./shell/browser-composition.js";
import { App } from "./shell/App.js";
import {CodeAppPage} from "./code-builder/CodeAppPage.js";

const root = document.getElementById("root");
if (root === null) throw new Error("appf2 shell root element is missing");

const { controller, launcher,publisher } = createBrowserComposition();

const codeMatch=/^\/code\/([0-9a-f-]{36})\/?$/iu.exec(globalThis.location.pathname);
createRoot(root).render(
  <StrictMode>
    {codeMatch!==null?<CodeAppPage shareId={codeMatch[1]} onHome={()=>globalThis.location.assign("/")} />:
      <App controller={controller} drafts={createBrowserPromptDraftStore()} launcher={launcher} publisher={publisher} />}
  </StrictMode>
);
