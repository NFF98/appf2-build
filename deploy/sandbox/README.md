# Sprint 3.5 — private candidate container broker

This Worker is **not deployed or wired to public creation**. Use only after explicit
cost controls, a secret `APPF2_SANDBOX_TOKEN`, internal service binding, and live
security admission review. It has `workers_dev:false`. No AI key or database key
is passed to the Linux container. The container launches with `enableInternet:false`.

Only `NODE` + `.mjs` candidate build/check/test is enabled initially. The broker
accepts a complete SHA-verified immutable project; it will not run a model-selected
shell command or install dependencies. A Durable Object is keyed to one job.
Call ID replay is persisted and repeat calls return the original receipt or fail
closed if the original outcome is uncertain. A bounded process has a 30-second
remote deadline. This is not yet evidence of a real deployed container or complete
AI Agent / Workflow / Blueprint F02 integration.

Do not deploy via the normal free PR CI. Container start incurs Cloudflare usage.

## Durable Workflow candidate (disabled by default)

`CandidateAgentWorkflow` defines a persisted verify step and a single isolated
execution step (`step.do`, `retries.limit=0`). The private `/internal/workflow/start`
route creates a deterministically identified Workflow instance, never a public
job or published App. Both `/internal/execute` and `/internal/workflow/start`
require bearer authentication, the allowed job ID, **and** the protected
`APPF2_PAID_CONTAINER_CONSENT=OWNER_APPROVED_ONE_SHOT` setting. Workflow start
additionally requires `APPF2_SP35_WORKFLOW_ENABLED=OWNER_APPROVED_WORKFLOW`.
Neither setting is present in source control or dry-run CI. Workflow payloads
are capped at 64 KiB; larger projects must eventually pass content-addressed
references, not raw files, through durable steps. These settings are **not** a
substitute for verified plan and spend controls. Nothing here is deployed.

Authenticated `GET /internal/workflow/status/<job_id>-<call_id>` reads only the
Workflow lifecycle state (no source code, model output, or command logs). The
route does **not** start or charge a container and remains private when the
spend-enabled execution path is disabled.

## Vite web-app isolation (2026-10-29 candidate)

The private container image preinstalls a fixed set of Vite, TypeScript, React,
and React DOM packages at image-build time. Runtime has Internet **disabled**;
it never runs `npm install`, `npm run <model script>`, or a model-selected
shell command. A fixed `node /opt/appf2/node_modules/vite/bin/vite.js build .
--outDir dist --emptyOutDir` compiles a verified VITE_WEB snapshot into its
private workspace. A fixed local `web-smoke.mjs` checks the compiled index and
its referenced static JS/CSS files. `run_test` requires a matching successful
`run_build` project hash, stored in the Durable Object. Browser interaction QA
is **separate**, NOT provided by web-smoke. Unsupported Python builds fail closed.

The free CI additionally builds this exact Dockerfile, copies ONLY the
repository's known trusted multi-file fixture into a network-denied local
container, and checks that both the real Vite build and static asset smoke
succeed. This proves a locally built container image, NOT Cloudflare
deployment, model-authored code execution, or universal app QA.

## Independent browser verification of isolated build output

The same non-deploying Docker CI also starts a separate Chromium browser,
serves the trusted fixture's Docker-produced static site, clicks the Add
button and checks the real result. It separately creates an actual candidate
project from `createInitialAgentProject`, compiles its four source files inside
the network-denied container, and checks real browser rendering including
a prompt with HTML-like content. These checks are independent from Vite exit
status but **only validate trusted source**. They never count as an
unknown model-authored app QA pass or authorize publication.

## Private Worker-to-Worker transport

The Sandbox Worker remains `workers_dev:false`. The agent Worker now supports
`APPF2_SANDBOX_BROKER_SERVICE` as a **private Cloudflare Service Binding**
to service `appf2-sp35-private-sandbox`. The binding and token are configured
only in protected deployment configuration; no public `workers.dev` URL is
necessary. With a binding configured, `APPF2_SANDBOX_BROKER_URL` is ignored,
and a failed private request never retries or falls back to public fetch.
The protected agent Worker must still enable both the candidate and Sandbox
feature flags and provide a private bearer token (minimum 32 characters),
owner-signed job and exact DB reservation/consent. Do NOT deploy or enable
paid container consent as part of ordinary GitHub PR CI.
