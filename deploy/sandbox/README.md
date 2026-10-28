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
