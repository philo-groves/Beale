# Secret Isolation

Status: accepted initial direction, 2026-04-26.

## Decision

Beale should protect secrets through capability boundaries, VM isolation, scoped credential injection, redaction, and sensitivity labels.

Encryption can be useful hardening, but it is not the core local security model.

## Honest Limitation

Beale is a local application.

It cannot fully protect secrets from:

- A malicious local user with access to the same account.
- A compromised Beale host process.
- A tool policy that intentionally decrypts and displays secrets.
- Secrets that must exist in memory during use.

Beale can and must protect secrets from:

- Target code.
- Guest VMs.
- Model-visible context.
- Accidental logs and traces.
- Unscoped tool access.
- Subprocess environment leakage.

## Credential Storage

OpenAI OAuth credentials should use OS credential storage where practical:

- macOS Keychain.
- Windows Credential Manager.
- Linux secret service or equivalent.

Program test credentials should live in a scoped credential store rather than free-form notes.

The workspace database should store credential references and metadata, not plaintext high-value credentials by default.

If a plaintext or file-based fallback exists, Beale should make the weaker protection visible to the user.

## Host Deny Paths

Agent-accessible host tools should deny sensitive paths by default.

Examples:

- Global Beale auth and config paths.
- Codex/OpenAI auth paths.
- OS credential files.
- Shell history.
- SSH private keys.
- `.env` files outside active scope.
- Raw `.beale/beale.sqlite`.
- Raw `.beale/logs` unless explicitly exported.

This is not a complete security boundary against a compromised host process, but it reduces accidental leakage and blocks routine agent/tool access.

## VM Secret Isolation

Guest VMs should not receive host secrets by default.

Rules:

- No OpenAI OAuth tokens in the VM.
- No host SSH agent forwarding into the VM by default.
- No OS keychain or credential-manager access from the VM.
- No broad home-directory mounts.
- No direct workspace database mount.
- Program credentials enter the VM only through explicit scoped injection.
- Credential injection is recorded in the trace.
- VM is reverted or destroyed after credential use when practical.

## Scoped Credential Injection

When a program requires credentials for authorized testing:

- Credentials must be recorded as scoped assets.
- Injection must be per run, per attempt, or per task.
- Injection should use environment variables or temporary files with narrow lifetime.
- Injected credentials should be visible in trace metadata by reference, not value.
- The GUI should show that a run used scoped credentials.

The model should not receive secret values unless a human explicitly allows it.

## Model-Visible Redaction

Before tool outputs, logs, environment dumps, or file contents are shown to the model, Beale should run redaction.

Redact common secret patterns:

- OpenAI tokens.
- GitHub tokens.
- SSH private keys.
- API keys.
- Bearer tokens.
- Cookies.
- AWS, GCP, and Azure credentials.
- Password-like environment variables.

Redaction should happen before model-visible summaries are stored.

Raw artifacts may be stored locally when necessary, but should be marked sensitive and not shown to the model by default.

## Sensitivity Labels

Artifacts, trace events, notes, and logs should support sensitivity labels:

- `public`
- `program-confidential`
- `secret`
- `restricted`

Default visibility:

- `public`: model-visible.
- `program-confidential`: model-visible within the active workspace unless policy says otherwise.
- `secret`: not model-visible without explicit human approval.
- `restricted`: metadata-only unless explicitly opened by the user.

## Subprocess Environment Policy

Host subprocesses should receive a minimal environment.

Defaults:

- Strip variables matching names like `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `COOKIE`, and `CREDENTIAL`.
- Do not inherit full host environment for model-requested commands.
- Do not pass Beale/OpenAI auth material to subprocesses.
- VM subprocesses receive only scoped variables for the current task.

## Prompt-Injection Resistance

Target files, logs, webpages, debugger output, and program output are untrusted.

They cannot override Beale policy.

If target-controlled text asks the agent to reveal tokens, read credential paths, disable sandboxing, or exfiltrate data, Beale should treat it as hostile content and block the requested action when policy applies.

## Planning Consequence

Secret isolation is not one mechanism. It is the combination of:

- Trusted host / untrusted guest boundary.
- Local credential store.
- Host deny paths.
- Scoped injection.
- Redaction.
- Sensitivity labels.
- Minimal subprocess environments.

The implementation should prioritize preventing target code and model-visible traces from seeing secrets.
