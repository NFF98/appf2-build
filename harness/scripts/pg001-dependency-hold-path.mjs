import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * PG-001 protected dependency path while Sprint is HOLD. NOT a general dependency permission:
 * the diff may only ADD the two exact PG packages to package.json and their npm-registry lock entries,
 * with exactly one constitutional docket (validated by the Governance Gate) and no control-state change.
 */
export const PG001_DEPENDENCY_GATE_MARKER = "PG-001 exact HOLD dependency addition recognized (pg, @types/pg)";
export const PG001_DEPENDENCY_ADDITIONS = Object.freeze({
  dependencies: Object.freeze({ pg: "8.23.0" }),
  devDependencies: Object.freeze({ "@types/pg": "8.23.1" })
});
const lockAllowlist = new Set([
  "node_modules/pg", "node_modules/@types/pg", "node_modules/pg-cloudflare", "node_modules/pg-connection-string",
  "node_modules/pg-int8", "node_modules/pg-pool", "node_modules/pg-protocol", "node_modules/pg-types",
  "node_modules/pgpass", "node_modules/postgres-array", "node_modules/postgres-bytea", "node_modules/postgres-date",
  "node_modules/postgres-interval", "node_modules/split2", "node_modules/xtend"
]);
const RE_DOCKET = /^delivery\/constitutional-cases\/GOV-[A-Z0-9-]+\.json$/;
const RE_INTEGRITY = /^sha512-[A-Za-z0-9+/]+=*$/;

const canonical = v => {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
};
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const without = (obj, section, names) => {
  const out = { ...obj, [section]: { ...(obj?.[section] || {}) } };
  for (const n of names) delete out[section][n];
  return out;
};
const stripAdditions = obj => {
  let out = obj;
  for (const [section, deps] of Object.entries(PG001_DEPENDENCY_ADDITIONS)) out = without(out, section, Object.keys(deps));
  return out;
};
const additionsPresent = (before, after) => Object.entries(PG001_DEPENDENCY_ADDITIONS).every(([section, deps]) =>
  Object.entries(deps).every(([n, v]) => before?.[section]?.[n] === undefined && after?.[section]?.[n] === v));

const holdTruth = (cs, build) =>
  cs?.status === "HOLD" && cs.active_sprint === null && cs.active_build_spec === null && cs.active_task === null &&
  build?.implementation_enabled === false;

const exactManifest = (basePkg, headPkg) =>
  additionsPresent(basePkg, headPkg) && same(stripAdditions(basePkg), stripAdditions(headPkg));

const exactLockEntry = (key, entry) =>
  lockAllowlist.has(key) && typeof entry?.version === "string" &&
  entry.resolved === "https://registry.npmjs.org/" + key.slice("node_modules/".length) + "/-/" +
    key.slice(key.lastIndexOf("/") + 1) + "-" + entry.version + ".tgz" &&
  RE_INTEGRITY.test(entry.integrity || "");

const exactLock = (baseLock, headLock) => {
  const bp = baseLock?.packages, hp = headLock?.packages;
  if (!bp || !hp) return false;
  if (!same({ ...baseLock, packages: null }, { ...headLock, packages: null })) return false;
  if (!exactManifest(bp[""], hp[""])) return false;
  for (const k of Object.keys(bp)) if (k !== "" && !same(bp[k], hp[k])) return false;
  const added = Object.keys(hp).filter(k => !(k in bp));
  return added.every(k => exactLockEntry(k, hp[k])) &&
    hp["node_modules/pg"]?.version === PG001_DEPENDENCY_ADDITIONS.dependencies.pg &&
    hp["node_modules/@types/pg"]?.version === PG001_DEPENDENCY_ADDITIONS.devDependencies["@types/pg"];
};

export function exactPg001DependencyDiff({ changed, cs, build, baseCs, baseBuild, basePkg, headPkg, baseLock, headLock }) {
  if (!Array.isArray(changed) || changed.length !== 3) return false;
  const others = changed.filter(p => p !== "package.json" && p !== "package-lock.json");
  return changed.includes("package.json") && changed.includes("package-lock.json") &&
    others.length === 1 && RE_DOCKET.test(others[0]) &&
    holdTruth(cs, build) && same(baseCs, cs) && same(baseBuild, build) &&
    exactManifest(basePkg, headPkg) && exactLock(baseLock, headLock);
}

const showJson = (ref, rel) => {
  try { return JSON.parse(execFileSync("git", ["show", ref + ":" + rel], { encoding: "utf8", maxBuffer: 1 << 28 })); }
  catch { return null; }
};
const readJson = (root, rel) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); }
  catch { return null; }
};

export function isExactPg001DependencyHoldUpdate({ root, base, changed, cs, build }) {
  if (!base || /^0+$/.test(base) || !Array.isArray(changed) || !changed.includes("package-lock.json")) return false;
  return exactPg001DependencyDiff({
    changed, cs, build,
    baseCs: showJson(base, "delivery/CURRENT-SPRINT.json"), baseBuild: showJson(base, "build-spec/CURRENT.json"),
    basePkg: showJson(base, "package.json"), headPkg: readJson(root, "package.json"),
    baseLock: showJson(base, "package-lock.json"), headLock: readJson(root, "package-lock.json")
  });
}

/** Mandatory positive/negative regression assertions, executed by npm run gate on every CI run. */
export function testPg001DependencyHoldPathGuard() {
  const cs = { status: "HOLD", active_sprint: null, active_build_spec: null, active_task: null };
  const build = { active_baseline: "BS-P1-024", implementation_enabled: false };
  const basePkg = { name: "x", dependencies: { react: "19.3.0" }, devDependencies: { eslint: "10.11.0" } };
  const headPkg = { name: "x", dependencies: { react: "19.3.0", pg: "8.23.0" }, devDependencies: { eslint: "10.11.0", "@types/pg": "8.23.1" } };
  const reg = (name, version) => ({
    version, resolved: "https://registry.npmjs.org/" + name + "/-/" + name.slice(name.lastIndexOf("/") + 1) + "-" + version + ".tgz",
    integrity: "sha512-AAAA"
  });
  const baseLock = { name: "x", lockfileVersion: 3, packages: { "": basePkg, "node_modules/react": reg("react", "19.3.0") } };
  const headLock = { name: "x", lockfileVersion: 3, packages: {
    "": headPkg, "node_modules/react": reg("react", "19.3.0"),
    "node_modules/pg": reg("pg", "8.23.0"), "node_modules/@types/pg": reg("@types/pg", "8.23.1"), "node_modules/split2": reg("split2", "4.2.0")
  } };
  const changed = ["package.json", "package-lock.json", "delivery/constitutional-cases/GOV-PG001-DEPS-001.json"];
  const ok = { changed, cs, build, baseCs: cs, baseBuild: build, basePkg, headPkg, baseLock, headLock };
  const lockWith = packages => ({ ...headLock, packages: { ...headLock.packages, ...packages } });
  const cases = [
    ["exact pg dependency addition", true, {}],
    ["Sprint ACTIVE", false, { cs: { ...cs, status: "ACTIVE", active_sprint: "SP-P1-003", active_task: "T008" } }],
    ["implementation enabled", false, { build: { ...build, implementation_enabled: true } }],
    ["control state changed in same diff", false, { baseBuild: { ...build, active_baseline: "BS-P1-023" } }],
    ["product source in same diff", false, { changed: [...changed.slice(0, 2), "src/edge/worker-entry.ts"] }],
    ["no docket", false, { changed: ["package.json", "package-lock.json"] }],
    ["extra unrelated file", false, { changed: [...changed, "README.md"] }],
    ["pg version drift", false, { headPkg: { ...headPkg, dependencies: { ...headPkg.dependencies, pg: "8.24.0" } } }],
    ["extra dependency", false, { headPkg: { ...headPkg, dependencies: { ...headPkg.dependencies, axios: "1.0.0" } } }],
    ["existing dependency bumped", false, { headPkg: { ...headPkg, dependencies: { ...headPkg.dependencies, react: "19.4.0" } } }],
    ["script edited", false, { headPkg: { ...headPkg, scripts: { gate: "true" } } }],
    ["unlisted lock package", false, { headLock: lockWith({ "node_modules/evil": reg("evil", "1.0.0") }) }],
    ["existing lock entry modified", false, { headLock: lockWith({ "node_modules/react": reg("react", "19.4.0") }) }],
    ["non-registry tarball", false, { headLock: lockWith({ "node_modules/split2": { ...reg("split2", "4.2.0"), resolved: "https://evil.example/split2.tgz" } }) }],
    ["missing integrity", false, { headLock: lockWith({ "node_modules/split2": { ...reg("split2", "4.2.0"), integrity: undefined } }) }],
    ["lock root differs from manifest additions", false, { headLock: { ...headLock, packages: { ...headLock.packages, "": basePkg } } }]
  ];
  for (const [name, expected, patch] of cases) {
    if (exactPg001DependencyDiff({ ...ok, ...patch }) !== expected) throw Error("PG-001 dependency HOLD path self-test failed: " + name);
  }
  return cases.length;
}
