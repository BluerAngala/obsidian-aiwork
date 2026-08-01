import type { PiMainOnlyToolProvider } from "@pivi/pivi-agent-core/engine/pi/buildPiToolRegistryCore";
import type {
  McpManagementCoordinator,
  McpManagementMutation,
  McpManagementPlan,
} from "@pivi/pivi-agent-core/mcp/mcpManagementCoordinator";
import type {
  SkillsManagementCoordinator,
  SkillsManagementMutation,
  SkillsManagementPlan,
} from "@pivi/pivi-agent-core/skills/vault/skillsManagementCoordinator";
import {
  type AgentMcpServerInput,
  createPiviCommandsTool,
  createPiviMcpTool,
  createPiviSkillsTool,
  type PiviCommandsInput,
  type PiviManagementApprovalPort,
  type PiviManagementApprovalRequest,
  PiviManagementError,
  type PiviManagementMutationResult,
  type PiviManagementPlanField,
  type PiviManagementPlanValue,
  type PiviManagementPort,
  type PiviMcpInput,
  type PiviSkillsInput,
} from "@pivi/pivi-agent-core/tools/piviManagement";

import {
  type PiSlashCommandCatalog,
  PiviCommandsManagementError,
} from "./PiSlashCommandCatalog";

export type PiviManagementDomain = "mcp" | "skills" | "commands";

/** Bounded sanitized failure returned from a management refresh pass. */
export interface PiviManagementRefreshFailure {
  readonly target: string;
  readonly message: string;
}

/** Narrow same-turn refresh seam owned by the plugin host. */
export interface PiviManagementRefreshHost {
  refreshPiviManagement(
    domain: PiviManagementDomain,
  ): Promise<readonly PiviManagementRefreshFailure[]>;
}

const GENERIC_REFRESH_FAILURE_MESSAGE = "Runtime refresh failed.";
const MAX_REFRESH_FAILURES = 20;

export interface PiviManagementServiceDeps {
  mcp: McpManagementCoordinator;
  skills: SkillsManagementCoordinator;
  commands: PiSlashCommandCatalog;
  refresh: PiviManagementRefreshHost;
}

const EMPTY_PROVIDER_SUMMARY = {
  obsidianTools: [] as string[],
  obsidianCliAvailable: false,
  includeMcp: false,
  includeSkill: false,
  includeSubagent: false,
  includeWebSearch: false,
};

/**
 * Per-chat management port: workspace-global coordinators + invoking-tab approval.
 * Queries never approve or write. Mutations are plan → one-shot approve → exact-revision commit → refresh.
 */
export function createPiviManagementPort(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
): PiviManagementPort {
  return {
    executeMcp: (input, signal) => executeMcp(deps, approval, input, signal),
    executeSkills: (input, signal) => executeSkills(deps, approval, input, signal),
    executeCommands: (input, signal) => executeCommands(deps, approval, input, signal),
  };
}

/**
 * Factory that binds workspace coordinators once and produces a main-only provider
 * per chat from that chat's one-shot approval port.
 */
export function createPiviManagementMainOnlyToolProviderFactory(
  deps: PiviManagementServiceDeps,
  getDisabledTools: () => readonly string[] = () => [],
): (approval: PiviManagementApprovalPort | null) => PiMainOnlyToolProvider {
  return (approval) => {
    const port = createPiviManagementPort(deps, approval);
    return () => ({
      toolSpecs: [
        createPiviMcpTool(port),
        createPiviSkillsTool(port),
        createPiviCommandsTool(port),
      ].filter(tool => !getDisabledTools().includes(tool.name)),
      registeredToolSummary: EMPTY_PROVIDER_SUMMARY,
    });
  };
}

async function executeMcp(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
  input: PiviMcpInput,
  signal?: AbortSignal,
): Promise<unknown> {
  if (input.action === "list") return deps.mcp.query();
  if (input.action === "test") return deps.mcp.test(input.name, signal);

  const plan = await deps.mcp.plan(input);
  await requireConfirm(approval, buildMcpApprovalRequest(plan), signal);
  const committed = await deps.mcp.commit(plan, plan.revision, signal);
  const result: PiviManagementMutationResult<unknown> = {
    saved: true,
    refreshed: committed.refreshed,
    ...(committed.effective
      ? { effective: committed.effective }
      : committed.removedName !== undefined
        ? { effective: { name: committed.removedName, removed: true } }
        : {}),
    ...(committed.warnings ? { warnings: [...committed.warnings] } : {}),
    ...(committed.refreshFailures
      ? { refreshFailures: committed.refreshFailures.map((entry) => ({ ...entry })) }
      : {}),
  };
  return finalizeMutation(deps, "mcp", result);
}

async function executeSkills(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
  input: PiviSkillsInput,
  signal?: AbortSignal,
): Promise<unknown> {
  if (input.action === "list") {
    const { skills } = deps.skills.snapshot();
    return { skills };
  }
  if (input.action === "list_remote") {
    return deps.skills.listRemote(input.source, signal);
  }

  const plan = deps.skills.plan(input);
  await requireConfirm(approval, buildSkillsApprovalRequest(plan), signal);
  const committed = await deps.skills.commit(plan, plan.revision, signal);
  return finalizeMutation(deps, "skills", {
    saved: true,
    refreshed: committed.refreshed,
    effective: { skills: committed.skills },
    ...(committed.warnings ? { warnings: [...committed.warnings] } : {}),
    ...(committed.refreshFailures
      ? { refreshFailures: committed.refreshFailures.map((entry) => ({ ...entry })) }
      : {}),
  });
}

async function executeCommands(
  deps: PiviManagementServiceDeps,
  approval: PiviManagementApprovalPort | null,
  input: PiviCommandsInput,
  signal?: AbortSignal,
): Promise<unknown> {
  if (input.action === "list" || input.action === "get") {
    try {
      return await deps.commands.executeCommands(input, signal);
    } catch (cause) {
      throw mapCommandsError(cause);
    }
  }

  await requireConfirm(approval, buildCommandsApprovalRequest(input), signal);
  let committed: unknown;
  try {
    committed = await deps.commands.executeCommands(input, signal);
  } catch (cause) {
    throw mapCommandsError(cause);
  }
  const base = asMutationResult(committed);
  return finalizeMutation(deps, "commands", base);
}

async function requireConfirm(
  approval: PiviManagementApprovalPort | null,
  request: PiviManagementApprovalRequest,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!approval) {
    throw new PiviManagementError(
      "unavailable",
      "Pivi management confirmation is unavailable in this chat.",
    );
  }
  let decision: "confirm" | "deny" | "cancel";
  try {
    decision = await approval.requestApproval(freezeApprovalRequest(request), signal);
  } catch (cause) {
    if (isAbortError(cause) || signal?.aborted) {
      throw new PiviManagementError("cancelled", "Management confirmation was cancelled.", {
        cause: cause instanceof Error ? cause : undefined,
      });
    }
    throw new PiviManagementError(
      "unavailable",
      "Pivi management confirmation failed.",
      { cause: cause instanceof Error ? cause : undefined },
    );
  }
  throwIfAborted(signal);
  if (decision === "confirm") return;
  if (decision === "deny") {
    throw new PiviManagementError("denied", "User denied the management change.");
  }
  throw new PiviManagementError("cancelled", "Management confirmation was cancelled.");
}

async function finalizeMutation<T>(
  deps: PiviManagementServiceDeps,
  domain: PiviManagementDomain,
  result: PiviManagementMutationResult<T>,
): Promise<PiviManagementMutationResult<T>> {
  if (!result.saved) return result;
  // Sanitize coordinator failures at this app boundary before model-visible return.
  const failures: PiviManagementRefreshFailure[] = (result.refreshFailures ?? []).map((entry) =>
    sanitizeRefreshFailure(entry),
  );
  let refreshed = result.refreshed;
  try {
    const hostFailures = await deps.refresh.refreshPiviManagement(domain);
    for (const entry of hostFailures) {
      failures.push(sanitizeRefreshFailure(entry));
    }
    if (hostFailures.length > 0) refreshed = false;
  } catch (cause) {
    // Host should return failures rather than throw; keep a sanitized fallback.
    refreshed = false;
    failures.push({
      target: `views:${domain}`,
      message: GENERIC_REFRESH_FAILURE_MESSAGE,
    });
    void cause;
  }
  if (failures.length === 0 && refreshed) {
    return { ...result, refreshed: true };
  }
  return {
    ...result,
    refreshed: false,
    warnings: uniqueStrings([
      ...(result.warnings ?? []),
      "Configuration was saved, but some runtime refresh work failed.",
    ]),
    refreshFailures: failures.slice(0, MAX_REFRESH_FAILURES),
  };
}

function sanitizeRefreshFailure(
  entry: { target?: unknown; message?: unknown },
): PiviManagementRefreshFailure {
  const target = typeof entry.target === "string" && entry.target.trim()
    ? entry.target.trim().slice(0, 120)
    : "runtime";
  // Never forward raw underlying errors (may contain secrets/paths).
  return { target, message: GENERIC_REFRESH_FAILURE_MESSAGE };
}

function asMutationResult(value: unknown): PiviManagementMutationResult<unknown> {
  if (!value || typeof value !== "object") {
    return { saved: true, refreshed: true, effective: value };
  }
  const record = value as Record<string, unknown>;
  return {
    saved: record.saved === false ? false : true,
    refreshed: record.refreshed === false ? false : true,
    ...(record.effective !== undefined ? { effective: record.effective } : {}),
    ...(Array.isArray(record.warnings)
      ? { warnings: record.warnings.filter((entry): entry is string => typeof entry === "string") }
      : {}),
    ...(Array.isArray(record.refreshFailures)
      ? {
        refreshFailures: record.refreshFailures
          .filter((entry): entry is { target: string; message: string } => (
            !!entry
            && typeof entry === "object"
            && typeof (entry as { target?: unknown }).target === "string"
            && typeof (entry as { message?: unknown }).message === "string"
          ))
          .map((entry) => ({ target: entry.target, message: entry.message })),
      }
      : {}),
  };
}

function mapCommandsError(cause: unknown): PiviManagementError {
  if (cause instanceof PiviManagementError) return cause;
  if (cause instanceof PiviCommandsManagementError) {
    if (cause.code === "state_changed") {
      return new PiviManagementError("state_changed", cause.message, { cause });
    }
    return new PiviManagementError("validation_failed", cause.message, { cause });
  }
  return new PiviManagementError(
    "persistence_failed",
    cause instanceof Error ? cause.message : "Command mutation failed.",
    { cause: cause instanceof Error ? cause : undefined },
  );
}

function freezeApprovalRequest(
  request: PiviManagementApprovalRequest,
): PiviManagementApprovalRequest {
  return Object.freeze({
    domain: request.domain,
    action: request.action,
    title: request.title,
    revision: request.revision,
    ...(request.changeLines
      ? { changeLines: Object.freeze([...request.changeLines]) }
      : {}),
    ...(request.fields
      ? {
        fields: Object.freeze(
          request.fields.map((field) => Object.freeze({
            label: field.label,
            value: isPlanValueArray(field.value)
              ? Object.freeze([...field.value])
              : field.value,
          })),
        ),
      }
      : {}),
  });
}

function isPlanValueArray(
  value: PiviManagementPlanField['value'],
): value is readonly PiviManagementPlanValue[] {
  return Array.isArray(value);
}

function buildMcpApprovalRequest(plan: McpManagementPlan): PiviManagementApprovalRequest {
  const mutation = plan.mutation;
  const fields = mcpMutationFields(mutation);
  const changeLines = mcpChangeLines(mutation);
  return {
    domain: "mcp",
    action: mutation.action,
    title: mcpTitle(mutation),
    revision: plan.revision,
    ...(changeLines.length ? { changeLines } : {}),
    ...(fields.length ? { fields } : {}),
  };
}

function mcpTitle(mutation: McpManagementMutation): string {
  switch (mutation.action) {
    case "upsert":
      return `Update MCP server "${mutation.name}"`;
    case "set_enabled":
      return mutation.enabled
        ? `Enable MCP server "${mutation.name}"`
        : `Disable MCP server "${mutation.name}"`;
    case "remove":
      return `Remove MCP server "${mutation.name}"`;
  }
}

function mcpChangeLines(mutation: McpManagementMutation): string[] {
  if (mutation.action === "upsert") {
    return ["Apply the planned MCP server configuration."];
  }
  if (mutation.action === "set_enabled") {
    return [mutation.enabled ? "Enable this MCP server." : "Disable this MCP server."];
  }
  return ["Remove this MCP server and its owned credentials."];
}

function mcpMutationFields(mutation: McpManagementMutation): PiviManagementPlanField[] {
  const fields: PiviManagementPlanField[] = [
    { label: "Server", value: mutation.name },
  ];
  if (mutation.action === "set_enabled") {
    fields.push({ label: "Enabled", value: mutation.enabled });
    return fields;
  }
  if (mutation.action === "remove") return fields;
  return [...fields, ...mcpServerFields(mutation.server)];
}

function mcpServerFields(server: AgentMcpServerInput): PiviManagementPlanField[] {
  const fields: PiviManagementPlanField[] = [];
  if ("command" in server) {
    fields.push({ label: "Type", value: "stdio" });
    fields.push({ label: "Command", value: server.command });
    if (server.args?.length) fields.push({ label: "Args", value: [...server.args] });
    const envNames = server.env ? Object.keys(server.env).sort() : [];
    if (envNames.length) fields.push({ label: "Env names", value: envNames });
  } else {
    fields.push({ label: "Type", value: server.type });
    fields.push({ label: "URL", value: server.url });
    if (server.auth) fields.push({ label: "Auth", value: server.auth });
    const headerNames = server.headers ? Object.keys(server.headers).sort() : [];
    if (headerNames.length) fields.push({ label: "Header names", value: headerNames });
    if (server.bearerToken?.source === "systemEnvironment") {
      fields.push({ label: "Bearer token", value: `env:${server.bearerToken.variable}` });
    } else if (server.bearerToken?.source === "clear") {
      fields.push({ label: "Bearer token", value: "clear" });
    }
    if (server.oauth === false) {
      fields.push({ label: "OAuth", value: "disabled" });
    } else if (server.oauth) {
      if (server.oauth.grantType) fields.push({ label: "OAuth grant", value: server.oauth.grantType });
      if (server.oauth.clientId) fields.push({ label: "OAuth client ID", value: server.oauth.clientId });
      if (server.oauth.scope) fields.push({ label: "OAuth scope", value: server.oauth.scope });
      if (server.oauth.clearClientSecret) {
        fields.push({ label: "OAuth client secret", value: "clear" });
      }
    }
  }
  if (server.enabled !== undefined) fields.push({ label: "Enabled", value: server.enabled });
  if (server.contextSaving !== undefined) {
    fields.push({ label: "Context saving", value: server.contextSaving });
  }
  if (server.disabledTools?.length) {
    fields.push({ label: "Disabled tools", value: [...server.disabledTools] });
  }
  // Never copy Agent-provided prose (description) into confirmation cards.
  return fields;
}

function buildSkillsApprovalRequest(plan: SkillsManagementPlan): PiviManagementApprovalRequest {
  const mutation = plan.mutation;
  return {
    domain: "skills",
    action: mutation.action,
    title: skillsTitle(mutation),
    revision: plan.revision,
    changeLines: skillsChangeLines(mutation),
    fields: skillsFields(mutation),
  };
}

function skillsTitle(mutation: SkillsManagementMutation): string {
  switch (mutation.action) {
    case "install":
      return `Install Skills from "${mutation.source}"`;
    case "set_enabled":
      return mutation.enabled
        ? `Enable Skill "${mutation.name}"`
        : `Disable Skill "${mutation.name}"`;
    case "update":
      return `Update Skill "${mutation.name}"`;
    case "update_all":
      return "Update all package-managed Skills";
    case "remove":
      return `Remove Skill "${mutation.name}"`;
  }
}

function skillsChangeLines(mutation: SkillsManagementMutation): string[] {
  switch (mutation.action) {
    case "install":
      return ["Install Skills through the pinned package workflow."];
    case "set_enabled":
      return [mutation.enabled ? "Enable this Skill." : "Disable this Skill."];
    case "update":
      return ["Update this Skill from its package provenance."];
    case "update_all":
      return ["Update every package-managed Skill."];
    case "remove":
      return ["Remove this Skill from the vault."];
  }
}

function skillsFields(mutation: SkillsManagementMutation): PiviManagementPlanField[] {
  switch (mutation.action) {
    case "install": {
      const fields: PiviManagementPlanField[] = [
        { label: "Source", value: mutation.source },
      ];
      if (mutation.skillNames?.length) {
        fields.push({ label: "Skills", value: [...mutation.skillNames] });
      }
      return fields;
    }
    case "set_enabled":
      return [
        { label: "Skill", value: mutation.name },
        { label: "Enabled", value: mutation.enabled },
      ];
    case "update":
    case "remove":
      return [{ label: "Skill", value: mutation.name }];
    case "update_all":
      return [];
  }
}

function buildCommandsApprovalRequest(
  input: Extract<PiviCommandsInput, { action: "upsert" | "remove" | "move" }>,
): PiviManagementApprovalRequest {
  return {
    domain: "commands",
    action: input.action,
    title: commandsTitle(input),
    revision: input.catalogRevision,
    changeLines: commandsChangeLines(input),
    fields: commandsFields(input),
  };
}

function commandsTitle(
  input: Extract<PiviCommandsInput, { action: "upsert" | "remove" | "move" }>,
): string {
  switch (input.action) {
    case "upsert":
      return `Save command /${input.id}`;
    case "remove":
      return `Remove command /${input.id}`;
    case "move":
      return `Move command /${input.id}`;
  }
}

function commandsChangeLines(
  input: Extract<PiviCommandsInput, { action: "upsert" | "remove" | "move" }>,
): string[] {
  switch (input.action) {
    case "upsert":
      return ["Create or update this workspace command."];
    case "remove":
      return ["Delete this workspace command."];
    case "move":
      return ["Reorder this workspace command."];
  }
}

function commandsFields(
  input: Extract<PiviCommandsInput, { action: "upsert" | "remove" | "move" }>,
): PiviManagementPlanField[] {
  const fields: PiviManagementPlanField[] = [
    { label: "Command", value: `/${input.id}` },
    { label: "Catalog revision", value: input.catalogRevision },
  ];
  if (input.action === "upsert") {
    // Never copy Agent-provided prose (description/argumentHint) into confirmation cards.
    if (input.icon !== undefined) fields.push({ label: "Icon", value: input.icon });
    fields.push({ label: "Prompt", value: "updated" });
  } else if (input.action === "move") {
    if (input.beforeId) fields.push({ label: "Before", value: `/${input.beforeId}` });
    if (input.afterId) fields.push({ label: "After", value: `/${input.afterId}` });
  }
  return fields;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PiviManagementError("cancelled", "Management confirmation was cancelled.");
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === "AbortError" || /aborted/i.test(cause.message));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
