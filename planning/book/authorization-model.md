# Authorization Model

Status: accepted initial direction, 2026-04-26.

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

The sandbox exists to protect the human Beale researcher and their machine from potentially dangerous commands and executables. It is not primarily an authorization prompt mechanism.

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

## Host vs VM Policy

The agent should choose host or VM execution based on the task.

Host-allowed without approval:

- Clone in-scope repositories.
- Read-only file exploration.
- Search/read documentation.
- Inspect already imported metadata.
- Manage Beale workspace state.
- Prepare artifact imports for the VM.

VM-required:

- Running target executables.
- Running generated PoCs.
- Running project build scripts.
- Running tests from the target project.
- Mutation analysis.
- Fuzzing.
- Debugging target processes.
- Executing closed-source binaries.
- Running commands that may be influenced by untrusted target code.

For source repositories, Beale may clone and inspect on the host, but build, test, mutation, sanitizer, debugger, and PoC execution should happen on a scoped copy inside the VM.

Host-safe setup should use Beale-managed workspace operations, not a general host shell.

Examples:

- Clone an in-scope repository into the workspace.
- Fetch read-only metadata for an in-scope repository.
- Import a local in-scope file, binary, archive, or source tree.
- Copy selected workspace material into a guest VM.

These operations should validate scope mechanically, record trace events, and expose only narrow parameters. If the model requests host setup, Beale should route it through this workspace/import surface rather than arbitrary host command execution.

## Approval Model

The agent should ask for approval only when an action is potentially dangerous on the host machine or outside established scope.

Approval should be rare because dangerous execution should normally be routed into the VM.

Approval-required examples:

- Mutating host files outside the Beale workspace or cloned target checkout.
- Running target-controlled code on the host.
- Installing host-level software.
- Changing host firewall, hypervisor, credential, or system settings.
- Accessing paths outside configured scope.
- Making network requests outside configured scope.
- Preserving or exporting a contaminated VM beyond default lifecycle.
- Importing credentials into a VM.

Approval-not-required examples:

- Cloning an in-scope repository to the host.
- Reading in-scope source code on the host.
- Searching in-scope files.
- Copying cloned source into the VM for build/test/debug.
- Running target code inside the VM under the active scope and policy.
- Exporting selected VM artifacts into the local workspace artifact store.

## Network Policy

Network access should be controlled by the recorded program scope.

Default posture:

- Host network use is allowed for scoped clone/read/research operations.
- VM network is disabled by default.
- VM network can be enabled for in-scope domains, hosts, or services.
- Out-of-scope network access is blocked unless approval records a scoped exception or scope amendment.

Program scope should drive allowlists rather than ad hoc model decisions.

## Target Executables

If a target executable needs to run, it always runs in the VM.

This applies even when the executable is from an authorized program. Authorization to research a target is not authorization to run potentially dangerous code on the host.

## Agent Responsibility

The agent should decide whether a task belongs on the host or in the VM, using the policy above.

Beale should still enforce this decision mechanically:

- Tool metadata should indicate whether a command can run on host, VM, or both.
- Target execution tools should be VM-only.
- Host shell should be constrained to read-only or safe workspace operations by default.
- Host setup should prefer narrow workspace/import operations over host shell.
- Policy violations should fail closed.

## Planning Consequence

Authorization and sandboxing are related but separate:

- Authorization says what target assets Beale may research.
- Sandboxing says where and how risky operations may execute.

The first-release UX should make program scope explicit up front, then minimize prompts during normal in-scope research.
