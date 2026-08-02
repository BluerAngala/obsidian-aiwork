---
id: "041"
title: "Tool architecture hardening"
status: Completed
created: 2026-08-01
updated: 2026-08-01
coordinator: "Amp"
---

# 041 — Tool architecture hardening

## Context

This spec is the durable execution record for an architecture review from release `0.17.1-beta.5` (`565465fa`) through `d8fbc4b4` on the `beta` branch. The release delta contains three commits and approximately 114 changed files. It introduced Agent-managed Pivi capabilities and the built-in `/new` command, so the review followed their ownership and authorization paths across `@pivi/pivi-agent-core`, `src/app/workspace`, the UI, `@pivi/obsidian-host`, and `@pivi/obsidian-tools`.

The review also inspected complete current ownership boundaries where the delta exposed an existing implementation. Findings explicitly marked as pre-existing are release-readiness obligations, not regressions attributed to those three commits.

The current top-level architecture remains sound:

- `@pivi/pivi-agent-core` owns host-neutral `ToolSpec` contracts, schemas, domain protocols, and Pivi management tools.
- `src/app/workspace` owns Obsidian application orchestration, persistence transactions, approval, refresh, and composition.
- UI packages own per-tab approval interaction and presentation.
- `@pivi/obsidian-tools` owns concrete Obsidian-native adapters, CLI-backed Obsidian capabilities, registration, and capability gating.

`@pivi/obsidian-tools` already contains enough tool-related functionality. Its next architectural step is not to absorb every module whose name contains “tool”; it is to close authorization gaps, narrow mixed responsibilities, move one host-neutral tool to its proper owner, and delete duplicate implementations. In particular, `pivi_mcp`, `pivi_skills`, and `pivi_commands` remain Pivi domain capabilities in core rather than Obsidian SDK adapters.

The initial review passed both existing structural gates:

```bash
npm run check:architecture
npm run check:package-readmes
```

Those gates establish that documented import boundaries and package README coverage currently pass. They do not detect the semantic authorization, ownership, schema, localization, or duplicate-code findings below.

This spec is intentionally active and appendable. Every numbered finding is required work. Later detailed audits add evidence, decisions, or workstreams here rather than silently narrowing the current obligations.

## Goal and success criteria

Preserve the existing layer model while making authorization semantics singular, Pivi management transactions consistent, tool contracts self-describing, and package ownership truthful.

- [x] All ten numbered findings in this spec are implemented and verified, or an explicit decision entry replaces a finding with an equal or stronger outcome and records supporting repository evidence.
- [x] Bash allowlisting cannot authorize additional shell syntax or expansion outside the reviewed grant, and production and tests exercise one authorization policy.
- [x] Every Skills transaction directory is protected by the canonical Pivi managed-path policy for direct, descendant, and recursive-parent mutations.
- [x] Reserved slash-command identity is defined once and enforced consistently for Settings, Agent management, catalog projection, and dispatch, including upgrade behavior for an existing workspace `/new`.
- [x] Commands use a validated plan → approval → revision-checked commit path shared by Agent and Settings entrypoints; approval presentation is localized without polluting core DTOs.
- [x] Tool usage guidance and JSON Schema cannot drift on required revisions or mutually exclusive move anchors, and schema-level tests enforce the contract.
- [x] Duplicate frontmatter, vault edit matching, and Bash authorization implementations are removed from non-owning packages without changing supported behavior.
- [x] `pivi_sessions` is owned and composed from host-neutral core session tooling while retaining its tool name, schema, availability, and presentation.
- [x] `@pivi/obsidian-tools` exports, dependencies, tests, README, and package guidance describe only live owned behavior; architecture checks encode any newly enforceable ownership rule.
- [x] A final detailed repository audit records newly discovered findings, verifies no obligated item was lost, and synchronizes lasting boundaries into developer docs and layered `AGENTS.md` files before this spec is archived.

## Scope and non-goals

In scope:

- Authorization correctness for Bash grants and Pivi-managed Skills transaction paths.
- Reserved command IDs, Commands transaction ownership, management approval localization, and command schema/prompt consistency.
- Canonical ownership of frontmatter parsing, vault edit occurrence matching, Bash matching, and session recovery tooling.
- Descriptor ownership that keeps tool usage guidance adjacent to schemas/factories without reversing package dependencies.
- Package exports, dependencies, tests, README/guidance, architecture checks, compatibility decisions, and follow-up audit evidence needed by these changes.

Not in scope:

- Moving every `pivi_*` capability or every module mentioning tools into `@pivi/obsidian-tools`.
- Moving MCP, Skills, or Commands management ToolSpecs out of host-neutral core.
- Introducing a broad repository abstraction for Commands; the existing `FileStore` is the persistence seam unless implementation evidence proves it insufficient.
- Introducing a filesystem port solely to remove `fs`/`path` from `SkillsManagementCoordinator`; Vault-local Skills loading and synchronization are an intentional package exception. A complete reusable storage port may be proposed in a later decision, but a thin one-use wrapper is not part of this work.
- Moving React locale keys or locale-specific strings into core management DTOs.
- Pulling `obsidian.parseYaml` into host-neutral core merely to share the obsolete tools frontmatter implementation.
- Redesigning all of `createObsidianTools`; separating dependency construction from registry assembly may be evaluated later but is not a current completion requirement.

The following responsibilities remain in `@pivi/obsidian-tools`:

- `obsidian_*` tools that use Vault, MetadataCache, FileManager, or other Obsidian-native services.
- CLI-backed history, tasks, daily note, command, and eval capabilities.
- External read/list, image generation, attachment persistence, and Bash after its authorization fix.
- `ObsidianToolDeps`, capability approval gates, login-shell support, read ranges, pagination, and shared result helpers.
- Capability-sensitive tool registration/gating and `createObsidianTools` as the Obsidian tool composition factory.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-08-01 | Keep the current core → app/workspace → UI/Obsidian-adapter layering. | The reviewed release delta follows a coherent host-neutral domain, app orchestration, presentation, and native-adapter split; the findings require local corrections rather than a new architecture. | WS-01–WS-08 |
| 2026-08-01 | Treat all numbered findings as required work and keep this spec appendable. | The user requested execution of every finding and expects more detailed follow-up review. | WS-01–WS-08 |
| 2026-08-01 | Keep `pivi_mcp`, `pivi_skills`, and `pivi_commands` in core. | They model Pivi-owned domains and injected ports, not concrete Obsidian SDK adapters. | WS-03–WS-06 |
| 2026-08-01 | Do not add a Commands repository abstraction in the initial extraction. | `FileStore` already provides the required persistence seam; another layer would not yet remove real complexity. | WS-04 |
| 2026-08-01 | Keep the documented Vault-local filesystem exception for Skills coordination. | Replacing direct filesystem use is only valuable as a complete storage boundary, not as a one-use forwarding wrapper. | WS-02, WS-08 |
| 2026-08-01 | Preserve canonical Obsidian tool identities in core but stop duplicating detailed schemas and behavior prose there. | Stable names are domain identity; detailed usage belongs beside the schema/factory that can keep it accurate. | WS-06 |
| 2026-08-01 | Move `pivi_sessions` to core session tooling. | It depends only on an injected recovery port and has no Obsidian-native behavior. | WS-07 |
| 2026-08-01 | Preserve legacy reserved workspace command files byte-for-byte, shadow them from catalogs, and emit one actionable warning per path. | Built-ins must remain authoritative without silently deleting user content; users can recover a legacy command by renaming its file. | WS-03, WS-04 |
| 2026-08-01 | Remove the tools frontmatter and Vault edit helper exports without a deprecation layer. | `@pivi/obsidian-tools` is private, exports one source barrel, and repository search found no production consumer or external compatibility promise for either test-only API. | WS-07 |
| 2026-08-01 | Encode persisted Bash grants as readable `exact: <command>` or `prefix: <argv>` entries; treat untagged legacy entries as prefix grants only for known POSIX-compatible shells. | Exact review must not broaden into prefix authority, and POSIX parsing must never authorize `cmd.exe`, fish, or unknown-shell execution. | WS-01 |
| 2026-08-01 | Capture one login-shell invocation before Bash authorization and execute that exact invocation after approval. | Re-resolving `$SHELL` across an asynchronous approval would create a dialect TOCTOU gap. | WS-01 |
| 2026-08-01 | Keep Settings-only rename and whole-order operations as explicit typed coordinator methods rather than adding Agent actions or a repository layer. | They remain serialized, revision-aware app-owned mutations; the shared Agent/Settings upsert/remove paths use validated plans and CAS commits, while Settings-only capabilities do not need model-visible plans. | WS-04 |

## Findings and acceptance contracts

### F-01 — Block Bash allowlist shell-expansion bypasses (High, pre-existing)

Evidence owners: `packages/obsidian-tools/src/bashAllowlist.ts` (`DEFAULT_SAFE_BASH_ALLOWLIST`, `matchBashCommandAllowlist`) and `packages/obsidian-tools/src/obsidian/bash.ts`.

The production matcher authorizes a string prefix, then executes the complete string with `$SHELL -lc`. A default-safe `pwd` grant can therefore authorize `pwd ; ...`, `pwd && ...`, `pwd | ...`, `pwd $(...)`, and related shell expansion. A second executable/argv matcher exists but is not the production policy, leaving two inconsistent authorization models.

Acceptance contract:

- Settings allowlists and session/always grants use one policy and one production matcher.
- An exact command is handled according to one documented policy; a prefix grant applies only to a single command with no ungranted control operator, substitution, pipeline, or redirection.
- Tests cover at least `;`, `&&`, `||`, `|`, input/output redirection, backticks, `$()`, newline/control syntax, accepted exact commands, and accepted safe argument prefixes.
- The implementation accounts for `$SHELL -lc` semantics; it must not blindly apply an executable/argv parser whose assumptions differ from the executed string.
- The unused matcher/API is either made the sole actual policy or removed. Barrel exports, types, tests, README/guidance, and obsolete `fs`/`path` dependencies are cleaned up with it.

### F-02 — Protect Skills remove transaction roots (High)

Evidence owners: `packages/pivi-agent-core/src/skills/vault/vaultSkillsService.ts` creates `.pivi/skills-remove-<random>/`; `packages/obsidian-host/src/path/index.ts` defines `PIVI_MANAGED_PATH_NAMESPACES`.

The managed-path policy does not include `skills-remove-`, so standard Vault mutation tools can alter a Skills remove transaction during publication or rollback.

Acceptance contract:

- `.pivi/skills-remove-` is included in the canonical managed Skills directory prefixes.
- Tests reject a direct transaction root, its descendants, and a recursive parent operation that would contain it.
- A table-driven test enumerates every operation root produced through `withOperationRoot()` and proves it is protected, so future staging names cannot be added without updating policy coverage.
- Error ownership continues directing callers to the Skills management capability rather than leaking an internal path-policy distinction.

### F-03 — Define and enforce reserved slash-command IDs (Medium)

Evidence owner: `src/app/workspace/PiSlashCommandCatalog.ts`, including built-in `/new` composition and Agent command upsert checks; implementation must also trace Settings writes and tab/session dispatch.

The built-in `/new` now shares an ID that Agent management may persist because only `compact` and `generate-image` are protected. A workspace `new.md` can create duplicate catalog entries while dispatch still interprets `new` as session creation.

Acceptance contract:

- One `RESERVED_COMMAND_IDS` source includes at least `new`, `compact`, and `generate-image`.
- Settings and Agent mutation paths use the same reservation policy, and catalog composition plus dispatch cannot disagree with it.
- Before implementation, record a compatibility decision for pre-existing `.pivi/commands/new.md`; do not silently overwrite or delete user content.
- Catalog, both write entrypoints, dropdown projection, and final dispatch have focused tests for all reserved IDs and the chosen legacy `/new` behavior.

### F-04 — Extract the Workspace Commands transaction coordinator (Medium)

Evidence owners: `src/app/workspace/PiSlashCommandCatalog.ts` and `src/app/workspace/PiviManagementService.ts`.

`PiSlashCommandCatalog` currently combines Vault watching, built-in/runtime/workspace composition, dropdown projection, file persistence, revisions/recovery, Settings CRUD, and Agent CRUD. Commands also construct approval display from Agent input before completing domain validation, unlike the plan → approve → revisioned commit paths used for MCP and Skills.

Target ownership:

```text
WorkspaceCommandsCoordinator
  snapshot / plan / commit
  revision / reserved IDs
  persistence / ordering

PiSlashCommandCatalog
  watcher
  built-in/runtime/workspace composition
  dropdown projection
```

Acceptance contract:

- Settings and Agent writes converge on the coordinator's validated plan and revision-checked commit operations.
- Approval content is derived from a normalized, validated plan rather than raw Agent fields.
- Concurrent edits and watcher refreshes cannot turn an approved plan into a stale overwrite; stale state fails with the existing management error contract.
- The extraction introduces only the coordinator responsibility above and continues using `FileStore`; no speculative repository layer or pass-through helper is added.
- Focused tests cover snapshot revisions, create/update/remove/move ordering, approval TOCTOU, Settings/Agent parity, watcher interaction, and rollback/error behavior.

### F-05 — Localize Pivi management approval presentation (Medium)

Evidence owners: `src/app/workspace/PiviManagementService.ts`, `src/ui/chat/composer/piviManagementApprovalPrompt.ts`, and locale files under `packages/pivi-react/src/i18n/`.

Management approval titles, change lines, and field labels are currently assembled as hard-coded English in the app service. The UI localizes only generic card controls before displaying those English fields verbatim.

Acceptance contract:

- Approval display construction is moved from the service into an app-local pure presentation module at the app/UI boundary.
- Core request and plan DTOs remain structured and semantic; they do not contain React locale keys or locale-specific text.
- Every supported locale receives the same new keys in the implementation change, and dead/obsolete approval keys are removed.
- Tests prove normalized plans produce localized titles, fields, and changes for MCP, Skills, and Commands without displaying unvalidated raw Agent descriptions.

### F-06 — Make tool schema and prompt usage guidance one contract (Medium)

Evidence owners: `packages/pivi-agent-core/src/prompt/obsidianAgentTools.ts`, `packages/pivi-agent-core/src/tools/obsidianToolNames.ts`, and management tool schemas/factories.

The prompt manually repeats full argument contracts. It currently says only `move` needs `catalogRevision`, while the implementation requires revisions for `upsert`, `remove`, and `move`; the `move` parser also requires exactly one of `beforeId` and `afterId` without the schema fully expressing that exclusivity.

Acceptance contract:

- First correct `pivi_commands` usage guidance and encode the move-anchor XOR through `oneOf` or an equivalent schema construct.
- Schema-level tests validate revisions for every mutation and reject missing, both, or neither move anchors as applicable.
- `ToolSpec` or the registry result gains optional prompt-usage metadata defined adjacent to the owning schema/factory; the registered-tools prompt consumes that descriptor instead of maintaining a second behavior switch.
- Core does not gain a dependency on `@pivi/obsidian-tools`. Canonical names and stable identity metadata may remain in core, while concrete schema/behavior prose comes from the registered descriptor.
- Tests compare actual registered tools and generated guidance sufficiently to make a future argument-contract drift fail.

### F-07 — Remove the duplicate `obsidian-tools` frontmatter implementation

Evidence owners: `packages/obsidian-tools/src/frontmatter.ts`, `packages/pivi-agent-core/src/skills/frontmatter.ts`, `packages/pivi-agent-core/src/skills/slashCommand.ts`, and their barrels/tests/docs.

The tools implementation is exported and tested but has no production caller. It substantially duplicates core Skills frontmatter behavior and differs semantically while depending on `obsidian.parseYaml`.

Acceptance contract:

- Confirm whether the package export has an external compatibility obligation and record the decision before removal; use a documented deprecation only if evidence requires it.
- Keep production Skills frontmatter ownership in core and remove the tools copy, its barrel export, copy-only tests, documentation, and unused dependencies.
- Do not add an Obsidian YAML dependency to host-neutral core to preserve dead-code reuse.
- Core Skills parsing/serialization tests continue covering supported frontmatter behavior.

### F-08 — Canonicalize Vault edit occurrence matching in `obsidian-host`

Evidence owners: `packages/obsidian-tools/src/vaultEditMatch.ts` and `packages/obsidian-host/src/obsidianVaultApi.ts`.

The tools helper is export/test-only, while the real `editNote` path maintains another occurrence matcher and error behavior inside `ObsidianVaultApi`.

Acceptance contract:

- `@pivi/obsidian-host` owns one canonical helper and `ObsidianVaultApi.editNote` uses it.
- Existing zero, single, multiple, explicit-occurrence, invalid-occurrence, and replacement error semantics are characterized before extraction and remain compatible unless a recorded decision changes them.
- The tools copy, barrel export, and copy-only tests are removed; behavioral tests move to the canonical helper and real API path.

### F-09 — Finish Bash allowlist dead-API cleanup

This is coupled to F-01 but tracked separately so a security patch cannot leave the redundant authorization model behind.

Acceptance contract:

- Production calls, Settings/session grants, unit tests, and integration tests all exercise the same matcher and grant representation.
- No alternative canonical-executable or raw-prefix API remains exported solely for tests.
- Package README, `AGENTS.md`, barrel exports, dependency declarations, and test names describe the implemented policy rather than both historical models.

### F-10 — Move `pivi_sessions` to core session tooling

Evidence owners: `packages/obsidian-tools/src/obsidian/sessions.ts`, `createObsidianTools` composition, core session recovery ports, and app/base tool-provider composition.

`pivi_sessions` uses only an injected recovery port and no Obsidian SDK/native adapter. Its current package owner is therefore inaccurate.

Acceptance contract:

- The implementation and tests move under core session/tools ownership and are exported from the appropriate core boundary.
- App composition adds the tool through the base/main provider without creating a core → Obsidian package dependency.
- Tool name, input/output schema, runtime availability, registered-tools guidance, and UI projection remain compatible.
- `@pivi/obsidian-tools` exports, composition, tests, README/guidance, and architecture checks no longer claim host-neutral session recovery tooling.

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done`. A finding is complete only when its acceptance contract and documentation sync are evidenced; deleting a row does not remove the obligation.

| ID | Deliverable | Findings | Agent | Status | Dependencies | Verification focus |
|---|---|---|---|---|---|---|
| WS-01 | Replace Bash prefix authorization with one shell-aware grant policy and remove the dead model | F-01, F-09 | Amp | Done | None | Shell-control adversarial matrix, grant parity, exports/dependencies |
| WS-02 | Add every Skills operation root to managed-path policy | F-02 | Amp | Done | None | Direct/descendant/recursive parent and operation-root table |
| WS-03 | Unify reserved command identity and choose legacy `/new` migration behavior | F-03 | Amp | Done | None | Settings/Agent/catalog/dropdown/dispatch compatibility |
| WS-04 | Extract `WorkspaceCommandsCoordinator` and migrate both mutation entrypoints | F-04 | Amp | Done | WS-03 policy | Plan/approval/CAS commit, ordering, watcher, rollback |
| WS-05 | Move management approval display to a localized pure boundary | F-05 | Amp | Done | Validated plans from WS-04 where Commands are concerned | All locales, semantic DTOs, no raw input display |
| WS-06 | Co-locate tool usage descriptors with schemas and correct Commands contracts | F-06 | Amp | Done | Coordinate with active spec 040 contracts | Schema XOR/revisions and generated prompt fidelity |
| WS-07 | Remove/move duplicate and misowned tool modules | F-07, F-08, F-10 | Amp | Done | Public export compatibility decisions | Canonical behavior, package APIs, composition inventory |
| WS-08 | Run deeper architecture audit, append findings, synchronize durable docs, and execute release gates | All | Amp | Done | WS-01–WS-07 | Automated gates, live-host reload, user diff review, and follow-up fix verification |

Recommended execution phases:

1. **Phase 0 — security blockers:** WS-01 and WS-02.
2. **Phase 1 — consistency defects:** WS-03, the immediate schema corrections in WS-06, and WS-05 where independent.
3. **Phase 2 — responsibility extraction:** WS-04 and descriptor ownership in WS-06.
4. **Phase 3 — package/dead-code cleanup:** WS-07 plus final F-09 cleanup verification.
5. **Phase 4 — detailed re-audit and closeout:** WS-08; append new findings before completion rather than opening untracked TODOs.

## Verification

Each implementation workstream must run its narrow unit/integration suite and record exact commands in Progress and handoff. The combined closeout matrix includes:

| Area | Required evidence |
|---|---|
| Bash authorization | Accepted exact/prefix cases plus rejected control operators, pipelines, redirects, substitutions, multiline syntax, and parity across Settings/session/always grants |
| Managed Skills paths | All generated operation roots, direct roots, descendants, move source/destination, and recursive parent operations |
| Commands | Reserved IDs, legacy `/new`, Settings/Agent parity, validated approval, stale revision, ordering, watcher refresh, dropdown, and dispatch |
| Management i18n | Every supported locale, every management domain/action, long values, fallback behavior, and locale-key integrity |
| Ownership cleanup | Core/session registry inventory, real Vault edit API behavior, Skills frontmatter behavior, package exports/dependencies, and architecture boundary checks |

Minimum repository gates after all workstreams:

```bash
npm run test -- --runInBand tests/unit/pi/tools
npm run test -- --runInBand tests/unit/app
npm run test -- --runInBand tests/unit
npm run test -- --runInBand tests/integration
npm run typecheck
npm run lint
npm run check:boundaries
npm run check:architecture
npm run check:package-readmes
npm run check:specs
npm run build
git diff --check
```

The final implementation must also be checked in a live Obsidian host because command dispatch, catalog reconciliation, approvals, and tool registration cross the composition boundary:

```bash
obsidian plugin:reload id=pivi
obsidian dev:errors
```

Manual acceptance covers: a safe and unsafe Bash grant; one Skills operation while generic Vault mutation attempts target its transaction tree; an existing or simulated legacy `/new`; localized approval cards; Commands create/update/move/remove across two tabs; session recovery tool availability; and Vault edit occurrence behavior.

## Documentation sync

Before completion, synchronize lasting conclusions into:

- `docs/02-architecture-and-technology.md` and `docs/07-tools-skills-mcp-and-integrations.md` for package/tool ownership and registry descriptors.
- `docs/08-presentation-and-settings.md` for localized management approval and command identity where applicable.
- `docs/09-development-debugging-and-validation.md` plus the security/tooling sections of `docs/07-tools-skills-mcp-and-integrations.md` for Bash authorization, managed transaction paths, and architecture enforcement.
- `docs/10-roadmap-release-and-maintenance.md` for final audit/release evidence if required by that chapter's conventions.
- Root `AGENTS.md` plus the nearest guidance under `packages/obsidian-tools`, `packages/obsidian-host`, `packages/pivi-agent-core`, `packages/pivi-react/src/i18n`, `src/app/workspace`, and `src/ui/chat` for every changed ownership map or maintenance rule.
- Package READMEs, public barrels, dependency manifests, and architecture/boundary checks affected by F-01 through F-10.

Spec 040 remains the source for the original Agent-managed MCP, Skills, and Commands product contract. When F-03 through F-06 refine an overlapping requirement, update both specs' progress/decisions or move the lasting statement into owning docs so they do not close with contradictory contracts.

## Progress and handoff

### 2026-08-01 — release-delta architecture review — specification

- Changed: Reviewed `0.17.1-beta.5` (`565465fa`) through `d8fbc4b4`; retained the current layer model; recorded two high-priority security gaps, four contract/responsibility gaps, and four duplicate/ownership cleanup obligations as F-01 through F-10.
- Evidence: Current source paths and symbols listed under each finding; `npm run check:architecture` and `npm run check:package-readmes` passed during the review.
- Remaining: Execute WS-01 through WS-08; record the legacy `/new` and public-export compatibility decisions before destructive migration/removal; append findings from the planned deeper audit.
- Blockers: None for starting Phase 0. F-03 and F-07 require explicit compatibility evidence before final implementation choices.
- Next action: Claim WS-01 and implement the Bash authorization policy with the adversarial shell-syntax test matrix.

### Follow-up audit log

Append each later review as a dated entry with scope, commit/range, evidence, newly added or closed finding IDs, and the next action. New findings must receive a stable `F-NN` ID, acceptance contract, workstream owner, and verification requirement before implementation.

### 2026-08-01 — implementation and adversarial review — F-01 through F-10

- Changed: Implemented the canonical dialect-aware Bash grant model; protected all Skills operation roots; centralized reserved command IDs; extracted `WorkspaceCommandsCoordinator`; localized semantic management approval presentation; made registered ToolSpecs own detailed prompt usage; removed duplicate frontmatter and edit-matching code; moved `pivi_sessions` into core and base-provider composition.
- Compatibility: Legacy untagged Bash entries remain POSIX-safe prefixes; tagged exact grants remain exact. Legacy reserved Command files remain untouched but shadowed with a warning. Removed tools helper APIs had no production callers in the private package. Command prompt content preserves original leading/trailing bytes.
- Review: Two read-only adversarial reviews found and then verified fixes for Windows shell-dialect bypass, exact/prefix scope divergence, shell-resolution TOCTOU, unregistered-tool prompt recommendations, 32-bit revision collision, and command-content trimming. No blocker remains from the final review; the shell invocation and grant-representation gaps identified there were fixed and covered before the full suite.
- Focused evidence: Bash authorization/tool/session tests; managed-path operation-root matrix; Catalog/management/UI-port CAS and watcher tests; all-action/all-locale approval presentation tests; prompt sparse-inventory tests; canonical host edit tests; core frontmatter and session-tool registry parity tests.
- Remaining: User diff review and hands-on product scenarios listed under Manual acceptance. Keep this spec Active until that review is accepted, then record the result and archive it.
- Next action: Review the uncommitted diff, with priority on Bash grant persistence, `WorkspaceCommandsCoordinator`, prompt capability filtering, and package moves.

### 2026-08-01 — automated and live-host verification — WS-08

- Automated: `npm run test -- --runInBand` passed 328 suites and 2,772 tests; `npm run typecheck`, `npm run lint`, `npm run check:boundaries`, `npm run check:architecture`, `npm run check:package-readmes`, `npm run check:specs`, `npm run check:i18n-dead-keys`, `npm run build`, `npm run check:bundle-size`, and `git diff --check` passed. The production bundle is 4.14 MB with 0.86 MB below the hard 5 MB cap; the existing soft-baseline growth warning remains visible.
- Live host: `obsidian plugin:reload id=pivi` succeeded. `obsidian dev:errors` showed only two existing `pdf-plus` plugin errors and no Pivi error.
- Build: Production `main.js`, `manifest.json`, and `styles.css` were copied to the configured Obsidian plugin directory by the normal build workflow.
- Remaining: Manual interaction matrix and user code review; no implementation blocker is known.

### 2026-08-01 — user review follow-up — prompt and cleanup corrections

- Confirmed and fixed: Capability filtering had removed read pagination and external-path guidance when a related read tool was absent; guidance is now generated from the actual read capabilities before the final safety filter. The Bash persistent-prefix approval now displays the decoded argv token rather than the encoded `prefix:` settings entry. Settings command saves now surface catalog-refresh failure instead of silently returning with stale in-memory state. Obsolete commented implementations and the test-only `obsidian-tools` `tokenizeArgv` alias were removed.
- Clarified: The review's proposed legacy Bash fallback was not applied. F-01's recorded policy remains authoritative: untagged legacy entries are prefix grants only on known POSIX-compatible shells; unsupported and unknown dialects require an explicitly tagged exact grant. The contradictory package README sentence was corrected.
- Retained by design: `PiSlashCommandCatalog` keeps its compatibility facade methods while delegating every mutation to `WorkspaceCommandsCoordinator`; this is the compatibility decision already recorded for F-04, not a second mutation owner. Direct callers cannot bypass coordinator validation, revision checks, persistence, or refresh policy.
- Focused evidence: Prompt sparse-inventory, Bash allowlist/session, Commands catalog, and management-service suites passed (95 tests). Architecture/spec/diff checks passed; source/test typecheck was rerun after the final presentation fix.
- Remaining: User diff review and hands-on product scenarios; keep this spec Active until accepted.

## Completion summary

- **Ownership changes delivered:** One dialect-aware Bash grant policy (`exact:` / `prefix:`) now lives in `@pivi/pivi-agent-core/tools/bashAuthorization` and is shared by Settings, session, and always grants; approval and execution reuse one captured login-shell invocation. Every Skills transaction root joined the canonical managed-path namespaces. Reserved command identity is unified, legacy `.pivi/commands/new.md` is preserved byte-for-byte but shadowed with a warning. `WorkspaceCommandsCoordinator` owns validated plans, monotonic revisions, CAS commits, persistence, and ordering for both Settings and Agent entrypoints. Management approval presentation moved to a localized pure app boundary over normalized semantic plans. Detailed tool usage moved onto `ToolSpec.promptUsage` beside its factory/schema, and the registered-tools prompt filters recommendations by actual registration. Duplicate frontmatter, vault edit matching, and the old Bash matchers were removed; `pivi_sessions` moved to core session tooling and is composed through the shared base provider.
- **Compatibility decisions:** Legacy untagged Bash entries remain prefix grants only on known POSIX-compatible shells; unsupported/unknown dialects require an explicitly tagged `exact:` grant (the proposed implicit legacy→exact fallback was rejected; the contradictory README sentence was corrected instead). `PiSlashCommandCatalog` retains its mutation facade for compatibility while delegating every mutation to the coordinator. Removed test-only helper APIs (`tokenizeArgv` alias, tools frontmatter, tools vault edit matcher) had no production consumers.
- **User review follow-up:** Prompt capability filtering no longer drops read pagination/maxChars/external-path guidance in sparse tool configurations; the Bash always-allow second step displays the decoded argv prefix instead of the `prefix:` storage encoding; Settings command saves now fail loudly when the catalog refresh fails after a successful write; obsolete commented implementations were deleted.
- **Verification:** Full gate matrix green (`typecheck`, `lint`, `check:boundaries`, `check:architecture`, `check:package-readmes`, `check:specs`, `check:i18n-dead-keys`, `build`, `check:bundle-size`; 328 suites / 2,772 tests). Follow-up fixes re-verified with 111 focused tests across prompt, Bash allowlist/grants, Commands catalog, and management approval suites. Live `obsidian plugin:reload id=pivi` succeeded with no Pivi errors. User diff review accepted all findings and resolutions on 2026-08-01.
- **Documentation synchronized:** Root `AGENTS.md`, package/local `AGENTS.md` files (obsidian-host, obsidian-tools, pivi-agent-core, src/app), package READMEs, and numbered docs 02, 03, 07, 08, 09, 10.
