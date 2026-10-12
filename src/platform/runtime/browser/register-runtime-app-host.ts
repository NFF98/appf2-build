import { createBrowserAppHost } from "./runtime-app-host.js";

/**
 * Page entry loaded before the Shell: publishes the F03 browser host in a fixed, non-writable slot, so the Shell
 * reaches F03 only through the `RuntimeAppHost` projection type and never imports F03 code (F00-AC-020).
 */
Object.defineProperty(globalThis, Symbol.for("appf2.f03.runtime-app-host"), {
  value: Object.freeze(createBrowserAppHost()),
  writable: false,
  configurable: false,
  enumerable: false
});
