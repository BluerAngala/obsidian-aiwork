---
id: "040"
title: "Agent-managed Pivi capabilities"
status: Draft
created: 2026-07-31
updated: 2026-07-31
coordinator: "Unassigned"
---

# 040 — Agent-managed Pivi capabilities

## Context

Pivi already exposes one Pivi-namespaced Agent tool, `pivi_sessions`, while MCP servers, Vault Skills, and workspace Commands are managed only through Settings or direct Vault files. The three subsystems already have most of the required domain behavior:

- MCP has validated Vault-local configuration, structured value sources, SecretStorage publication, connection diagnostics, cached inventories, bridge reload, and runtime tool synchronization.
- Skills has an exact pinned `skills` package, bounded process execution, staged tree validation, atomic replacement, enable/disable markers, and prompt/slash refresh notifications.
- Commands has Markdown serialization, stable integration keys, a Vault watcher, slash-catalog refresh, and dynamic Obsidian command reconciliation.

The existing Settings adapters are not a safe Agent API. MCP Settings saves caller-owned whole-list snapshots; Command persistence writes files directly; Skills operations and Settings mutations do not share one transaction coordinator; several apparent read paths may perform migration writes. Runtime refresh also needs stronger semantics when a management tool changes the active Agent's tools or prompt during a turn.

Generic Vault mutation tools can currently write Pivi-managed paths directly. Adding confirmation only to new management tools would therefore be bypassable through `obsidian_write`, `obsidian_edit`, `obsidian_move`, or `obsidian_delete`. Unrestricted Bash/eval can bypass Vault-level path policy and must remain an explicitly documented separate authority rather than being covered by a false absolute guarantee.

This spec defines three main-Agent-only tools:

| Tool | Purpose |
|---|---|
| `pivi_mcp` | Query, configure, enable, remove, and test persisted MCP servers. |
| `pivi_skills` | Query and manage Skills only through Pivi's pinned `skills` package workflow. |
| `pivi_commands` | Query and manage Vault-local Pivi slash Commands. |

Pivi Skills do not accept generated `SKILL.md` bodies, arbitrary files, source trees, or publish destinations through the Agent tool. Users may author Skill files separately; `pivi_skills` is only a safe interface to the existing `skills` package operations.

## Goal and success criteria

Allow the main Agent to add and manage Pivi capabilities through narrow, validated tools without exposing secrets, bypassing user authorization, losing concurrent Settings changes, or requiring a manual Pivi refresh.

- [ ] `pivi_mcp`, `pivi_skills`, and `pivi_commands` expose the action sets and narrow schemas defined in this spec, appear in the main Agent registry and registered-tools prompt, and are structurally absent from subagent registries.
- [ ] Every query action is non-interactive and uses a redacted, non-mutating snapshot; every mutation builds a trusted structured plan, requests exactly one sidebar inline confirmation, rechecks its revision, commits atomically, and returns a sanitized effective-state projection.
- [ ] Settings and Agent mutations use the same app-owned coordinators, serialization, revision checks, secret/provenance rules, and refresh coordinator; stale snapshots or state changes during confirmation fail with `state_changed` rather than overwriting or silently rebasing.
- [ ] Standard Agent Vault mutation APIs reject operations whose source, destination, or recursive target would alter Pivi-managed MCP, Skills, Commands, metadata, staging, or OAuth paths and direct the Agent to the matching `pivi_*` tool.
- [ ] MCP Agent DTOs never expose or accept raw bearer tokens, OAuth client secrets, secret headers, or secret environment values; omitted secret fields preserve existing values and explicit clearing is represented separately.
- [ ] Skill installation/update imports only output attributable to the current pinned-CLI operation; the tool has no action or parameter that can publish Agent-provided Skill content.
- [ ] A successful mutation automatically refreshes every affected open Pivi tab, the invoking Agent's next provider continuation, tool registries, system prompts, slash catalogs, MCP inventories, and Obsidian command registrations as applicable.
- [ ] Persistence failure performs no refresh; refresh failure after persistence returns `saved: true`, `refreshed: false`, and bounded target failures without misreporting the durable state.
- [ ] Concurrent Agent calls, Settings edits, Vault watcher events, cancellations, denials, tab disposal, and plugin unload fail closed without partial publication, leaked pending approvals, terminated unrelated MCP calls, or lost updates.
- [ ] Focused unit/integration tests, architecture checks, typecheck, lint, production build, plugin reload, and `npm run check:specs` pass with the acceptance scenarios below.

## Scope and non-goals

In scope:

- Three action-oriented ToolSpecs, Agent-safe DTOs, main-only registry composition, registered-tool guidance, and canonical presentation descriptors.
- Shared app-owned MCP, Skills, Commands, confirmation, mutation, and refresh coordinators used by Agent tools and Settings adapters.
- Revisioned plan/confirm/commit transactions, atomic publication, managed-path protection, strict refresh reporting, and active-turn-safe runtime updates.
- Read-only capability snapshots, MCP diagnostics constraints, pinned Skills package provenance, and Command identity/order behavior.
- Localized sidebar confirmation presentation and deterministic mutation result/error contracts.

Not in scope:

- `pivi_plugins`; the current plugin registry is declarative and has no product persistence, trust, install, enablement, or runtime contribution pipeline.
- A broad `pivi_settings` tool or arbitrary settings patching.
- A standalone `pivi_refresh` tool; refresh is part of each committed transaction. Recovery from manually edited files continues through existing Vault watchers/startup behavior.
- Agent-authored or Agent-published Skill content, arbitrary file payloads, direct Skill destination selection, or replacing the pinned `skills` package workflow.
- Claiming containment against separately enabled Bash/eval or OS-level filesystem access; those capabilities retain their own explicit approval/allowlist authority.

## Decisions

| Date | Decision | Rationale | Affected workstreams |
|---|---|---|---|
| 2026-07-31 | V1 contains exactly `pivi_mcp`, `pivi_skills`, and `pivi_commands`. | These are the capability domains with existing product services; plugins/settings are either incomplete or too broad. | WS-01–WS-07 |
| 2026-07-31 | Skills management only invokes the exact pinned `skills` package through the existing bounded process/staging pipeline. | Pivi should install/manage package-owned Skills, not become an arbitrary Agent content publisher. | WS-04 |
| 2026-07-31 | `pivi_skills` has no `publish`, file-content, `SKILL.md`, source-tree, or destination parameter. | Users can author Skill files separately; model-visible file payloads would weaken provenance and publication containment. | WS-01, WS-04 |
| 2026-07-31 | Queries require no approval; every mutation requires one non-reusable sidebar inline confirmation. | Capability installation changes prompts, network access, command surfaces, or executable configuration and is sensitive to indirect prompt injection. | WS-02 |
| 2026-07-31 | Pivi management confirmation uses a dedicated one-shot port rather than Bash/directory session grants. | Its type and UI must make `allow-session` and `allow-always` impossible. | WS-02 |
| 2026-07-31 | Tools call a host-neutral management port implemented by app-owned coordinators; they do not call React Settings ports or app modules directly. | Settings and Agent entrypoints need one policy/transaction source while preserving package boundaries. | WS-01, WS-03–WS-05 |
| 2026-07-31 | Mutation protocol is snapshot → normalize/validate → plan/revision → confirm → revision recheck → commit → refresh → sanitized result. | This prevents confirmation TOCTOU and stale whole-list overwrites. | WS-02–WS-06 |
| 2026-07-31 | State changes while confirmation is open fail as `state_changed`; Pivi does not silently rebase or open a second confirmation. | The user's approval must apply to exactly the previewed change. | WS-02, WS-03–WS-05 |
| 2026-07-31 | Management tools are supplied through an explicit main-only provider, not a name blacklist over the shared base provider. | Subagents must be structurally unable to discover or invoke self-management tools. | WS-01 |
| 2026-07-31 | Standard Agent Vault mutation paths protect Pivi-managed namespaces while manual user edits remain supported. | Otherwise the new confirmation boundary is trivially bypassable. | WS-02 |
| 2026-07-31 | MCP Agent input cannot contain raw secrets; it can reference system environment, preserve/clear existing secrets, and report only configured/source metadata. | Tool arguments are model-visible, rendered, and persisted in session history before storage can redact them. | WS-03 |
| 2026-07-31 | Automatic refresh is transactional and generation-aware; no standalone `pivi_refresh` is added. | A committed capability should become usable automatically, including in the invoking turn's next provider continuation. | WS-06 |
| 2026-07-31 | MCP reload uses generation/drain semantics rather than closing all active pools. | A change from one tab must not terminate an unrelated in-flight MCP call in another tab. | WS-03, WS-06 |
| 2026-07-31 | All management ToolSpecs use `executionMode: 'sequential'`. | Parallel sibling management calls would make approval revisions and refresh ordering ambiguous. | WS-01 |

## Tool contracts

All actions use discriminated JSON schemas with `additionalProperties: false`. Unknown actions, unknown fields, empty identifiers, traversal-like names, invalid URLs, shell syntax in stdio executables, stale revisions, and unsupported secret inputs fail before approval. Mutation confirmation text is generated from normalized Pivi-owned plans, never copied from Agent-provided descriptions.

Common mutation result:

```ts
interface PiviManagementMutationResult<T> {
  saved: boolean;
  refreshed: boolean;
  effective?: T;
  warnings?: string[];
  refreshFailures?: Array<{ target: string; message: string }>;
}
```

### `pivi_mcp`

| Action | Mutation | Contract |
|---|---:|---|
| `list` | No | Return persisted server summaries and cache-only tool inventory using a redacted Agent DTO. Do not connect, migrate, or expose secret values. |
| `test` | No | Accept only a persisted server name. Do not accept ad hoc config, initiate OAuth, write credentials, or automatically spawn every stdio server. Return authentication-required explicitly. |
| `upsert` | Yes | Add or update one server by name using normalized remote/stdio variants. Renaming is not supported in V1. Omitted secret metadata preserves existing values. |
| `set_enabled` | Yes | Toggle one existing server without replacing unrelated server records. Enabling stdio is confirmed with executable, argument vector, cwd policy, and environment variable names, never values. |
| `remove` | Yes | Remove one server and all associated bearer, OAuth-client, header/env, stored OAuth, inventory, and connection state. |

The Agent DTO contains only safe configuration fields and secret projections such as `{ source: 'secret', configured: true }` or `{ source: 'systemEnvironment', variable: 'NAME' }`. New keychain values must be entered through Settings or a future dedicated user-only secure input that never enters ToolSpec arguments.

MCP mutation operations read the current record inside a serialized coordinator and commit keyed `upsert`, `setEnabled`, or `remove` operations. Settings must either use the same keyed operations or provide revision-bearing compare-and-swap when editing a complete list. A mutex without revision checking is insufficient.

### `pivi_skills`

| Action | Mutation | Contract |
|---|---:|---|
| `list` | No | Return installed package/service metadata and enabled state from a non-mutating snapshot. |
| `list_remote` | No | Invoke the pinned package's list operation for one normalized source through the bounded process runner. |
| `install` | Yes | Install from one normalized package source with optional package-reported Skill names. Import only files attributable to this isolated CLI operation. |
| `set_enabled` | Yes | Enable or disable one installed Skill identity through the service. Agent-facing naming is positive even if storage uses a disabled marker. |
| `update` | Yes | Update one installed Skill identity; resolve CLI provenance/update name inside the coordinator instead of accepting an unchecked name/folder pair. |
| `update_all` | Yes | Update all installed package-managed Skills through the pinned package. |
| `remove` | Yes | Remove one installed Skill and preserve existing default-bundle metadata behavior. |

Construction of a query service must not create `.pivi`, migrate root metadata, or modify disabled markers. Workspace initialization owns migrations; Agent query actions consume a prepared snapshot. Routine installs use an operation-specific staging/output root and do not sweep generic `.agents/skills`, `.cursor/skills`, `skills`, or other roots that an unrelated Agent write could seed. Legacy discovery remains an explicit startup migration path.

### `pivi_commands`

| Action | Mutation | Contract |
|---|---:|---|
| `list` | No | Return workspace Command metadata without prompt bodies. |
| `get` | No | Return one Command's editable prompt content and metadata. |
| `upsert` | Yes | Create or update one exact Command ID. Agent input is limited to name/ID, description, argument hint, icon, and prompt content. |
| `remove` | Yes | Remove one exact workspace Command. Built-ins and runtime entries are not eligible. |
| `move` | Yes | Move one Command before/after another using a catalog revision, avoiding stale whole-list reorder writes. |

Pivi generates and preserves `integrationKey`, scope, source, persistence key, editability, and deletion policy. V1 does not rename an existing ID inside `upsert`; rename requires a future explicit atomic operation because save-new/delete-old can break external integration identity. Command writes use atomic replacement, mutation serialization, strict parse/refresh errors, stable integration-key preservation, Obsidian command reconciliation, and slash-cache invalidation.

## Managed-path policy

The standard Agent mutation boundary rejects exact paths, descendants, and recursive parent operations that would affect:

| Namespace | Owner/tool |
|---|---|
| `.pivi/mcp.json`, `.pivi/mcp-oauth/**` and MCP-owned secret/config artifacts | `pivi_mcp` |
| `.pivi/skills/**`, package metadata, operation staging, publish/backup roots | `pivi_skills` |
| `.pivi/commands/**`, `.pivi/templates/**`, Command order metadata | `pivi_commands` |

The policy applies to write, edit, delete, move source/destination, mkdir where applicable, and any recursive parent mutation exposed by standard Agent Vault tools. It returns the matching management-tool instruction. Obsidian/user filesystem edits and Vault watchers remain available. Bash/eval are separate privileged capabilities; documentation must not claim that managed-path policy contains arbitrary OS access.

## Runtime refresh contract

The app-owned refresh coordinator returns strict per-target results instead of relying on broadcasts that log and swallow failures.

| Domain | Required committed-state refresh |
|---|---|
| MCP | Publish manager snapshot; create a new bridge/pool generation; invalidate tool caches; drain old in-flight calls; sync main-Agent registries/prompts; invalidate and warm slash inventories for enabled remote servers only. |
| Skills | Invalidate Skill/slash snapshots; rebuild Skills prompt appendices and main-Agent system prompts; refresh composer slash caches. |
| Commands | Refresh the catalog strictly; reconcile dynamic Obsidian commands; invalidate and warm slash caches in every open tab. |

The invoking runtime increments a configuration generation. If a management mutation commits during a tool call, it updates `agent.state.tools` and the system prompt immediately and marks that generation dirty. Before the next provider continuation, Pivi's existing next-turn context hook overlays the refreshed tools and prompt onto the authoritative continuation while preserving its message array. Sibling tool calls already emitted in the same assistant message retain the original registry.

No refresh waits for the invoking tab to become idle. MCP generations retire only after their in-flight calls settle; plugin unload cancels/drains them under the existing disposal lifecycle.

## Workstreams

Use `Pending`, `Claimed`, `In progress`, `Blocked`, or `Done` for workstream status.

| ID | Deliverable | Agent | Status | Dependencies | Verification |
|---|---|---|---|---|---|
| WS-01 | Define narrow Agent DTOs, three discriminated ToolSpecs, registered-tool prompt/presentation entries, and explicit shared/main-only Pi tool providers | Unassigned | Pending | None | Schema/adapter/registry tests prove exact main/subagent inventories and sequential execution |
| WS-02 | Add one-shot structured confirmation, revisioned mutation plans, cancellation lifecycle, and standard Agent managed-path protection | Unassigned | Pending | WS-01 contracts | Approval/TOCTOU/path-source/path-destination/recursive-parent/subagent tests |
| WS-03 | Build shared MCP coordinator with pure snapshots, keyed/CAS mutation, redacted DTOs, complete secret cleanup, safe diagnostics, and generation/drain connections; migrate Settings | Unassigned | Pending | WS-01, WS-02 | MCP storage, secret, concurrency, diagnostics, active-call, and Settings/Agent race tests |
| WS-04 | Build shared Skills coordinator with pure snapshots, pinned-package-only operations, isolated attributable output, canonical identities, serialization, and default-bundle metadata; migrate Settings | Unassigned | Pending | WS-01, WS-02 | Fake process/filesystem provenance, no-content-schema, rollback, race, and refresh tests |
| WS-05 | Build shared Commands coordinator with atomic keyed mutation, stable generated identity, revisioned move, strict refresh, and Settings migration | Unassigned | Pending | WS-01, WS-02 | Atomic fault, identity, race, watcher, registry, and order tests |
| WS-06 | Implement strict cross-view refresh reporting and active-turn configuration generations for MCP/tools/prompts/slash catalogs | Unassigned | Pending | WS-03–WS-05 | Same-turn continuation, multi-tab failure, draining MCP, and disposal tests |
| WS-07 | Adversarial integration matrix, i18n, docs/guidance sync, full quality gates, production build, and live Obsidian reload | Unassigned | Pending | WS-01–WS-06 | Commands and manual scenarios in Verification |

## Verification

Required authorization and concurrency scenarios:

- A note, web result, Skill, or MCP result requests a capability mutation; the main Agent receives one normalized confirmation and denial/cancel performs no write or refresh.
- Settings changes the same MCP server, Skill, or Command while confirmation is open; commit fails `state_changed` and preserves the Settings change.
- Main-Agent parallel tool proposals execute management calls sequentially; subagent tool inventory contains none of the three management tools.
- Generic Vault write/edit/delete/move/mkdir cannot affect managed exact paths, descendants, or recursive parents; the error directs the Agent to the owning tool.
- View disposal, session switch, cancellation, and plugin unload settle pending confirmations and operations without a late commit.

Required MCP scenarios:

- List output and session tool history contain no raw secrets; omitted secret metadata preserves values; explicit clear/remove deletes every owned secret and OAuth artifact.
- `test` rejects ad hoc config, does not authenticate, and does not write; remote and one explicitly named stdio server remain bounded by existing network/process policy.
- A committed MCP change is visible to the invoking Agent's next provider continuation and other tabs; an unrelated in-flight MCP call finishes on its retired generation.
- Persistence failure leaves the old manager/bridge generation active; one-tab refresh failure returns truthful partial status without rolling back the durable commit.

Required Skills and Commands scenarios:

- `pivi_skills` schemas reject Skill bodies, file arrays, source trees, and destinations; install/update invoke the exact pinned package with `shell: forbidden` and import only operation-attributable output.
- Failed or malicious Skill operations leave the prior Skill byte-identical and preserve enabled/default-bundle metadata; a successful mutation refreshes prompts and slash catalogs.
- Command create/update preserves generated integration identity, atomic publication survives injected write faults, `move` rejects stale revisions, and built-in/runtime entries cannot be mutated.
- Settings and Agent operations share coordinators and cannot overwrite each other with stale whole-list or stale order snapshots.

Commands:

```bash
npm run test -- --runInBand tests/unit/pi/tools
npm run test -- --runInBand tests/unit/mcp
npm run test -- --runInBand tests/unit/pi/skills
npm run test -- --runInBand tests/unit/app
npm run test -- --runInBand tests/integration
npm run typecheck
npm run lint
npm run check:boundaries
npm run check:architecture
npm run build
obsidian plugin:reload id=pivi
obsidian dev:errors
npm run check:specs
```

Manual live-host acceptance:

- Add and enable one non-secret remote MCP server, approve once, observe tools become available without reload, then remove it.
- Install, disable, enable, update, and remove one package-managed Skill while observing prompt/slash availability across two open Pivi tabs.
- Create, edit, move, and remove one Pivi Command while observing slash and Obsidian command-palette reconciliation.
- Deny each mutation type once and confirm no durable or runtime state changes.
- Keep one MCP call active in another tab while changing MCP configuration and confirm the active call completes.

Human visual sign-off:

- Inspect MCP, Skills, and Commands mutation confirmation cards in main and pop-out windows, light and dark themes, including long normalized values, keyboard focus, Confirm, Deny, cancel, pending, and error states.

## Documentation sync

- Numbered developer docs: `docs/03-plugin-lifecycle-and-composition.md`, `docs/06-subagents-streaming-and-rendering.md`, `docs/07-tools-skills-mcp-and-integrations.md`, `docs/08-presentation-and-settings.md`, and `docs/09-security-and-boundaries.md` if present; otherwise the nearest existing security/tooling chapter.
- Nearest local guidance: `src/app/AGENTS.md`, `src/ui/AGENTS.md`, `src/ui/chat/AGENTS.md`, and any narrower changed-area guidance.
- Parent/package guidance: `packages/pivi-agent-core/AGENTS.md`, `packages/obsidian-tools/AGENTS.md`, `packages/pivi-react/AGENTS.md`, and `packages/pivi-react/src/i18n/AGENTS.md` as affected.
- Root guidance and roadmap: `AGENTS.md`, `README.md`, `SECURITY.md`, and `docs/10-roadmap-release-and-maintenance.md` as affected by the final implementation.

## Progress and handoff

### 2026-07-31 — architecture discussion — specification

- Changed: Defined three main-Agent-only Pivi management tools; excluded Agent-authored Skill publication; selected one-shot mutation confirmation and automatic transactional refresh.
- Evidence: Existing MCP storage/bridge, pinned Skills service/staging, Command catalog/watcher, Settings adapters, capability approval bridge, Pi registry, and runtime refresh paths.
- Remaining: Review this Draft, assign a coordinator, set Active, then execute WS-01 through WS-07 in dependency order.
- Blockers: None for specification. Implementation must establish shared coordinators and runtime refresh semantics before adding thin ToolSpec wrappers.
- Next action: Review action names and security boundaries, then activate WS-01.

## Completion summary

Complete this section before archiving. Summarize the delivered outcome, deviations from the original scope, verification results, and durable documentation updated. The coordinator then sets `status: Completed`, updates the date, moves the unchanged filename to `archive/`, and moves its index entry in the same change.
