# Sprints

每個 Sprint 使用獨立目錄：
```text
delivery/sprints/SP-P1-001/
├─ manifest.json
├─ tasks.json
└─ gate-report.md
```

Sprint 必須由 locked Build Spec 派生。不得建立沒有 Acceptance/Test traceability 的正式 implementation task。

Task lifecycle：
`PLANNED → IN_PROGRESS → BLOCKED | REVIEW → VERIFIED → CLOSED`


## Future Sprint Naming / Reservation Rule

Planning documents may describe future work by stable stage name, but **must not reserve a future numeric `SP-P1-NNN`**.

A numeric Sprint ID becomes canonical only when:

1. detailed planning creates its `delivery/sprints/SP-P1-NNN/` artifacts from a locked Build Spec;
2. the ID is the next unique canonical Sprint identifier at creation time; and
3. Human approval activates that Sprint.

Historical IDs are immutable: never rename, recycle, or reinterpret an existing Sprint ID. Legacy provisional roadmap labels do not reserve numbers and do not authorize scope.

The same principle applies to future Build Specs: a roadmap must not pre-book `BS-P1-NNN`; the numeric ID is allocated only when the actual Human-approved Build Freeze candidate is created.
