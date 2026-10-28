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
