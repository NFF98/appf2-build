## Scope

Task: <!-- Txxx；治理／非 Task PR 留空並刪除本行 -->
<!-- 同一 Task 已有 open PR 時才需要：PR-Justification: <NONCOMBINABLE_AUTHORITY_BOUNDARY|CONTROL_TRANSITION_AFTER_MERGE|HOTFIX|SUPERSEDES_CLOSED_PR> <說明> -->

- Active Build Spec:
- Sprint:
- Backlog Item(s):
- AC/Test IDs:
- Existing open PR for this Task (gpt-preflight output):

## Change Type

- [ ] Implementation / Bugfix (same Task lease)
- [ ] Test
- [ ] Evidence / Closure
- [ ] Finding
- [ ] Governance
- [ ] Human exception lane (`delivery/constitutional-cases/GOV-*.json`)
- [ ] Hotfix
- [ ] Build Spec Freeze / Rebaseline
- [ ] Release

## Required Evidence

- [ ] Impacted tests (Draft fast loop) — NOT a full-gate PASS
- [ ] `npm run gate`
- [ ] Required Task commands
- [ ] Acceptance/Test evidence (`proof_level` labelled where applicable)
- [ ] No out-of-scope files

## Final Ready

Only the Human marks this PR Ready for review (Final Ready). Any new commit invalidates Final Ready, BCE and merge approval for the previous HEAD.

## Governance-only changes

Complete only when applicable:

- User decision reference:
- Source appf2 Working commit:
- Previous Build Spec:
- New Build Spec:
- Approved DESIGN_DELTA IDs:
- [ ] Activation Record included
- [ ] Affected Sprint was BLOCKED before rebaseline
- [ ] CODEOWNER review required

**Cursor/automation must not self-approve governance-only changes.**
