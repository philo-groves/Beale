# Authorization Model

Status: revised sandbox default, 2026-04-28.

## Decision

Beale authorization is program-scoped.

Each vulnerability research program or organization defines the allowed scope. The agent may work inside that scope without per-action approval.

Examples of scoped assets:

- Domains.
- Source repositories.
- Executables.
- Packages.
- Services.
- Local files.
- Documentation.
- Test accounts or credentials provided for the program.

The sandbox exists to protect the human Beale researcher and their machine from potentially dangerous commands and executables. It is not primarily an authorization prompt mechanism. The default session sandbox is host execution with a visible warning; VM execution remains preferred for risky work, while Docker is an explicit lower-assurance option.

## Scope Model

Each workspace should record the active program scope:

- Program or organization name.
- Scope description.
- In-scope domains and hosts.
- In-scope repositories.
- In-scope executables and binaries.
- In-scope local paths.
- In-scope accounts, credentials, or tokens.
- Explicit out-of-scope assets.
- Network policy.
- Expiration or review date where applicable.
- User notes about program rules.

The agent can operate autonomously inside this recorded scope.

## Host vs Sandbox Policy

Beale should choose the session sandbox from the user's session settings. The default is `host_research_only`; users can opt into a sandbox-backed profile through the sandbox settings.

Host-allowed without approval:

- Clone in-scope repositories.
- Read-only file exploration.
- Search/read documentation.
- Inspect already imported metadata.
- Manage Beale workspace state.
- Prepare artifact imports for the selected sandbox.

VM-preferred:

- Running target executables.
- Running generated PoCs.
- Running project build scripts.
- Running tests from the target project.
- Mutation analysis.
- Fuzzing.
- Debugging target processes.
- Executing closed-source binaries.
- Running commands that may be influenced by untrusted target code.

For source repositories, Beale may clone and inspect on the host. In the default host sandbox, build, test, mutation, sanitizer, debugger, and PoC execution also run on the host and are covered by the New Research Session warning. In sandbox-backed sessions, the same operations should happen on a scoped copy inside the selected sandbox.

Host-safe setup should use Beale-managed workspace operations, not a general host shell.

Examples:

- Clone an in-scope repository into the workspace.
- Fetch read-only metadata for an in-scope repository.
- Import a local in-scope file, binary, archive, or source tree.
- Copy selected workspace material into the selected sandbox.

These operations should validate scope mechanically, record trace events, and expose only narrow parameters. If the model requests host setup, Beale should route it through this workspace/import surface rather than arbitrary host command execution.

## Approval Model

The agent should ask for approval only when an action is potentially dangerous on the host machine or outside established scope.

Approval should be rare because the user chooses the session sandbox up front. The host-execution warning is the default-session disclosure.

Approval-required examples:

- Mutating host files outside the Beale workspace or cloned target checkout.
- Running target-controlled code on the host outside a session that was started with the host-execution warning.
- Installing host-level software.
- Changing host firewall, hypervisor, credential, or system settings.
- Accessing paths outside configured scope.
- Making network requests outside configured scope.
- Preserving or exporting a contaminated sandbox beyond default lifecycle.
- Importing credentials into a sandbox.

Approval-not-required examples:

- Cloning an in-scope repository to the host.
- Reading in-scope source code on the host.
- Searching in-scope files.
- Running in-scope commands inside the selected session sandbox.
- Exporting selected artifacts into the local workspace artifact store.

## Network Policy

Network access should be controlled by the recorded program scope.

Default posture:

- Host network use is allowed for scoped clone/read/research operations.
- Host network use in host-backed sessions follows the recorded scope and session network profile.
- Sandbox network can be enabled for in-scope domains, hosts, or services when the backend can enforce the selected profile.
- Out-of-scope network access is blocked unless approval records a scoped exception or scope amendment.

Program scope should drive allowlists rather than ad hoc model decisions.

## Target Executables

If a target executable needs to run, a VM-backed sandbox is preferred but no longer mandatory by default.

Authorization to research a target is not authorization to ignore host risk. Beale must make host execution visible before the session starts and keep the selected sandbox in trace metadata.

## Agent Responsibility

The agent should respect the selected session sandbox.

Beale should still enforce this decision mechanically:

- Tool metadata should indicate whether a command ran on host, VM, Docker, or another sandbox backend.
- Target execution tools should run in the active session sandbox.
- Host shell should still avoid unrelated host paths and secrets.
- Host setup should prefer narrow workspace/import operations over host shell.
- Policy violations should fail closed.

## Planning Consequence

Authorization and sandboxing are related but separate:

- Authorization says what target assets Beale may research.
- Sandboxing says where and how risky operations may execute.

The first-release UX should make program scope explicit up front, then minimize prompts during normal in-scope research.
