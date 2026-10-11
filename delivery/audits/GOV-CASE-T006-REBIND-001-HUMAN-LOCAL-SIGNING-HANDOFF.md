# GOV-CASE-T006-REBIND-001 — Human local signing handoff (2026-10-11)

**Status: R1–R3 direct Human chat decisions preserved, cryptographically verified signatures 0/5. R4 Human decision PENDING, R5 NOT AUTHORIZED.**

The following is a **local-only, Human-operated utility** shared in the present ChatGPT conversation, not a canonical repo signing implementation. It is deliberately **not installed as a GitHub Workflow or authorization mechanism**. No Human private key is held in GitHub, ChatGPT, or this PR.

## Released local-tool archive integrity

- Archive: `APPf2-Human-R1-R3-Signing-Toolkit.zip`
- SHA256: `dffa28213a71d45299bdde0d2bbf2f294834ef079c57810b58247f25682b74f6`
- Contains `R4-HUMAN-LOCAL-SIGNER.mjs` (SHA256 `98b8d24a24c0d37a40eaba2c5b7af886faa448e0120d6657aeade00414d326cc`), `APPf2-Human-Sign.ps1` (SHA256 `e9dd1d8acec29e77348bb3078d17ad78a99cd28160432949ac4177134f11c90e`), Traditional Chinese README.
- Distribution: verified as current-conversation generated attachment; **archive bytes are not stored in GitHub SSOT**. Do not accept an unverified third-party copy.
- Tool only invokes authenticated GitHub CLI **read operations**: main branch SHA, original immutable dossiers by original SHA, and repository variable `APPF2_CONSTITUTION_PUBKEY_B64`. No `gh variable set`, GitHub write, Task activation, merge, or Cursor.
- The Human private key must stay local. Its encrypted PKCS8 PEM local copy is placed outside the repo at `%USERPROFILE%\Appf2-Human-Signing\GOV-CASE-T006-REBIND-001\human-ed25519.encrypted.pk8.pem`; the passphrase is read from a masked TTY, never provided to ChatGPT.
- Before signing, the tool verifies (i) exact pinned main `7bf5c9466e681719463560c2676ccb82ab097f0e`, (ii) independently retrieved, previously Human-approved R1/R2/R3 dossier byte SHA256, (iii) **actual local Ed25519 key fingerprint matches existing GitHub public key** and (iv) previously issued signed records.
- Signs **one stage per interactive command**, R1 then R2 then R3, each independently confirmed via `SIGN R1`, `SIGN R2`, `SIGN R3`; R4/R5 are rejected. Signing time is actual signing time, never backdated to original direct-chat approvals. The script never creates or submits a constitutional case docket and cannot unlock protected CI.
- If the GitHub public key is already configured but no matching Human private key is available, **HARD STOP**. Never generate a new key to replace the existing trust root or rotate `APPF2_CONSTITUTION_PUBKEY_B64` without a separate Human-authorized trust-root procedure.
- Original direct-chat approval evidence (from Human messages), not cryptographic proof: R1 `fc538abb9d4f1838c3639e0a7fd818f26aab3ae5`, R2 `17851adaff39bbd004e3235d7ed153edae7315e`, R3 `254c57a924839fb88a39748681ec628f9568dcfa`. The approved dossiers are now present on R4 Draft PR #364 with exact original Git blobs.
- Model-key isolated testing exercised original approved-digest inspection, public-key matching, sequential real Ed25519 R1→R2→R3 signing and local verification, R4 signing refusal, stage-skip refusal, invalid GitHub public-key refusal and tampered R2 receipt rejection. **No real Human private key/signature was accessed or issued**, and no production CI proof was created.

## Human next step (only initial inspect)

In Windows PowerShell with Node and authenticated `gh`, extract archive, then:

```powershell
node .\R4-HUMAN-LOCAL-SIGNER.mjs inspect
```

If all checks pass, the Human independently and explicitly executes each R1/R2/R3 signing step. If the key is in a different private PEM location, use the tool's `import-existing` command to import an **encrypted, matching, local-only** copy. Never share a private key or password; only Human-reviewed public signature receipt JSON may be included later in the precise protected docket.

**Governance state unchanged:** PR #364 remains DRAFT, `main` unchanged, BS025 not activated, T006 BLOCKED, R4/R5 not Human-approved. Independent Ed25519 signatures remain 0/5 until externally submitted and cryptographically verified; real signing cannot be inferred from creating this guide.
