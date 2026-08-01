import { isSecretLikeKey } from '../foundation/configValueSource';
import type { SyncSecretStore } from '../ports';
import type {
  AgentMcpSecretProjection,
  AgentMcpServerInput,
  AgentMcpServerSummary,
  PiviMcpInput,
  PiviMcpListResult,
  PiviMcpTestResult,
} from '../tools/piviManagement';
import { PiviManagementError } from '../tools/piviManagement';
import {
  listMcpServerSecretIds,
  type McpStorage,
  McpStorageStateChangedError,
} from './mcpStorage';
import { normalizeMcpStoredValueMap } from './mcpValueSources';
import { listMcpAuthEntrySecretIds } from './oauth/mcpSecretAuthStore';
import type { AppMcpDiagnostics, AppMcpServerTester, AppMcpToolProvider } from './ports';
import type { ManagedMcpServer, McpTestResult } from './types';
import { DEFAULT_MCP_SERVER, getMcpServerType } from './types';

export type McpManagementMutation = Extract<PiviMcpInput, { action: 'upsert' | 'set_enabled' | 'remove' }>;

export interface McpManagementPlan {
  revision: string;
  mutation: McpManagementMutation;
}

export interface McpManagementCommitResult {
  revision: string;
  saved: true;
  refreshed: boolean;
  effective?: AgentMcpServerSummary;
  removedName?: string;
  warnings?: string[];
  refreshFailures?: Array<{ target: string; message: string }>;
}

export interface McpManagementSettingsSnapshot {
  servers: ManagedMcpServer[];
  revision: string;
}

export interface McpManagementCoordinatorOptions {
  storage: McpStorage;
  toolProvider: AppMcpToolProvider;
  tester: AppMcpServerTester;
  diagnostics?: AppMcpDiagnostics;
  secretStorage?: SyncSecretStore;
  removeOAuthArtifacts?(serverName: string): Promise<void>;
  publish?(servers: readonly ManagedMcpServer[], changedName: string): Promise<void> | void;
}

function projectRef(ref: { kind: string; value?: string; name?: string }): AgentMcpSecretProjection {
  if (ref.kind === 'secret') return { source: 'secret', configured: true };
  if (ref.kind === 'systemEnvironment') {
    return { source: 'systemEnvironment', variable: ref.name ?? '' };
  }
  return { source: 'plain', value: ref.value ?? '' };
}

function projectMap(raw: unknown): Record<string, AgentMcpSecretProjection> | undefined {
  const map = normalizeMcpStoredValueMap(raw);
  if (!map) return undefined;
  return Object.fromEntries(Object.entries(map).map(([key, ref]) => [
    key,
    isSecretLikeKey(key) && ref.kind === 'plain'
      ? { source: 'secret', configured: (ref.value?.length ?? 0) > 0 }
      : projectRef(ref),
  ]));
}

function redactServer(
  server: ManagedMcpServer,
  tools: ReturnType<AppMcpToolProvider['getCachedTools']> = [],
  secretStorage?: SyncSecretStore,
): AgentMcpServerSummary {
  const type = getMcpServerType(server.config);
  const common = {
    name: server.name,
    type,
    enabled: server.enabled,
    contextSaving: server.contextSaving,
    ...(server.description ? { description: server.description } : {}),
    ...(server.disabledTools ? { disabledTools: [...server.disabledTools] } : {}),
    ...(tools.length ? { tools: tools.map((tool) => ({ ...tool })) } : {}),
  };
  if (type === 'stdio') {
    const config = server.config as { command: string; args?: string[]; env?: unknown };
    return {
      ...common,
      command: config.command,
      ...(config.args ? { args: [...config.args] } : {}),
      ...(projectMap(config.env) ? { env: projectMap(config.env) } : {}),
    };
  }
  const config = server.config as { url: string; headers?: unknown };
  const oauth = server.oauth === false
    ? false
    : server.oauth
      ? {
          ...(server.oauth.grantType ? { grantType: server.oauth.grantType } : {}),
          ...(server.oauth.clientId ? { clientId: server.oauth.clientId } : {}),
          ...(server.oauth.scope ? { scope: server.oauth.scope } : {}),
          clientSecret: server.oauth.clientSecret || hasSecret(secretStorage, listMcpServerSecretIds(server.name, 'client-secret'))
            ? { source: 'secret' as const, configured: true }
            : { source: 'none' as const },
        }
      : undefined;
  return {
    ...common,
    url: config.url,
    auth: server.auth ?? 'none',
    ...(projectMap(config.headers) ? { headers: projectMap(config.headers) } : {}),
    bearerToken: server.bearerToken || hasSecret(secretStorage, listMcpServerSecretIds(server.name, 'bearer-token'))
      ? { source: 'secret', configured: true }
      : server.bearerTokenEnv
        ? { source: 'systemEnvironment', variable: server.bearerTokenEnv }
        : { source: 'none' },
    ...(oauth !== undefined ? { oauth } : {}),
  };
}

function hasSecret(storage: SyncSecretStore | undefined, ids: readonly string[]): boolean {
  return !!storage && ids.some((id) => !!storage.getSecret(id));
}

function mergeValueMap(
  previousRaw: unknown,
  input: Record<string, { source: string; value?: string; variable?: string }> | undefined,
): Record<string, { kind: 'plain'; value: string } | { kind: 'secret' } | { kind: 'systemEnvironment'; name?: string }> | undefined {
  const next = { ...(normalizeMcpStoredValueMap(previousRaw) ?? {}) };
  if (!input) return Object.keys(next).length ? next : undefined;
  for (const [key, value] of Object.entries(input)) {
    if (value.source === 'clear') delete next[key];
    else if (value.source === 'plain') next[key] = { kind: 'plain', value: value.value ?? '' };
    else next[key] = { kind: 'systemEnvironment', name: value.variable };
  }
  return Object.keys(next).length ? next : undefined;
}

function materializeUpsert(
  name: string,
  input: AgentMcpServerInput,
  previous: ManagedMcpServer | undefined,
): ManagedMcpServer {
  const enabled = input.enabled ?? previous?.enabled ?? DEFAULT_MCP_SERVER.enabled;
  const contextSaving = input.contextSaving ?? previous?.contextSaving ?? DEFAULT_MCP_SERVER.contextSaving;
  const common = {
    name,
    enabled,
    contextSaving,
    disabledTools: input.disabledTools ?? previous?.disabledTools,
    description: input.description ?? previous?.description,
  };
  if ('command' in input) {
    const oldEnv = previous && getMcpServerType(previous.config) === 'stdio'
      ? (previous.config as { env?: unknown }).env
      : undefined;
    return {
      ...common,
      config: {
        command: input.command,
        ...(input.args ? { args: [...input.args] } : {}),
        ...(mergeValueMap(oldEnv, input.env) ? { env: mergeValueMap(oldEnv, input.env) } : {}),
      },
    };
  }
  const oldHeaders = previous && getMcpServerType(previous.config) !== 'stdio'
    ? (previous.config as { headers?: unknown }).headers
    : undefined;
  const headers = mergeValueMap(oldHeaders, input.headers);
  const bearerTokenEnv = input.bearerToken?.source === 'systemEnvironment'
    ? input.bearerToken.variable
    : input.bearerToken?.source === 'clear'
      ? undefined
      : previous?.bearerTokenEnv;
  const oauth = input.oauth === undefined
    ? previous?.oauth
    : input.oauth === false
      ? false
      : {
          ...(previous?.oauth && typeof previous.oauth === 'object' ? previous.oauth : {}),
          ...input.oauth,
          ...(input.oauth.clearClientSecret ? { clientSecret: undefined } : {}),
        };
  if (oauth && typeof oauth === 'object') delete (oauth as { clearClientSecret?: boolean }).clearClientSecret;
  return {
    ...common,
    config: { type: input.type, url: input.url, ...(headers ? { headers } : {}) },
    auth: input.auth ?? previous?.auth,
    oauth,
    bearerToken: input.bearerToken?.source === 'clear' ? undefined : previous?.bearerToken,
    bearerTokenEnv,
  };
}

/** Shared serialized MCP transaction service for Settings and future Agent management. */
export class McpManagementCoordinator {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: McpManagementCoordinatorOptions) {}

  /** Narrow dispatch seam for the later aggregate; mutations stop at a revisioned plan. */
  async execute(input: PiviMcpInput, signal?: AbortSignal): Promise<PiviMcpListResult | PiviMcpTestResult | McpManagementPlan> {
    if (input.action === 'list') return this.query();
    if (input.action === 'test') return this.test(input.name, signal);
    return this.plan(input);
  }

  async query(): Promise<PiviMcpListResult> {
    const servers = await this.options.storage.loadSnapshot();
    return {
      servers: servers.map((server) => redactServer(
        server,
        this.options.toolProvider.getCachedTools(server.name),
        this.options.secretStorage,
      )),
    };
  }

  async test(name: string, signal?: AbortSignal): Promise<PiviMcpTestResult> {
    const servers = await this.options.storage.loadSnapshot();
    const server = servers.find((candidate) => candidate.name === name);
    if (!server) throw new PiviManagementError('validation_failed', `Unknown MCP server: ${name}`);
    this.hydrateDirectSecrets(server);
    // Agent diagnostics deliberately use the non-interactive tester. The Settings
    // diagnostics pool may invoke OAuth refresh/provider persistence.
    const result = await this.options.tester.testServer(server, signal);
    return this.toTestResult(name, result);
  }

  async plan(mutation: McpManagementMutation): Promise<McpManagementPlan> {
    const snapshot = await this.options.storage.loadRevisionedSnapshot();
    return { revision: snapshot.revision, mutation };
  }

  async getRevision(): Promise<string> {
    return (await this.options.storage.loadRevisionedSnapshot()).revision;
  }

  /** Settings-ready servers and CAS revision derived from one authoritative read. */
  async loadSettingsSnapshot(): Promise<McpManagementSettingsSnapshot> {
    const snapshot = await this.options.storage.loadRevisionedSnapshot();
    snapshot.servers.forEach(server => this.hydrateDirectSecrets(server));
    return snapshot;
  }

  commit(
    plan: McpManagementPlan,
    expectedRevision = plan.revision,
    signal?: AbortSignal,
  ): Promise<McpManagementCommitResult> {
    return this.serialized(async () => {
      this.throwIfAborted(signal);
      const loaded = await this.options.storage.loadRevisionedSnapshot();
      const snapshot = loaded.servers;
      if (loaded.revision !== expectedRevision || plan.revision !== expectedRevision) {
        throw new PiviManagementError('state_changed', 'MCP configuration changed after planning.');
      }
      const current = snapshot;
      current.forEach(server => this.hydrateDirectSecrets(server));
      const index = current.findIndex((server) => server.name === plan.mutation.name);
      const previous = index >= 0 ? current[index] : undefined;
      let effective: ManagedMcpServer | undefined;
      if (plan.mutation.action === 'upsert') {
        effective = materializeUpsert(plan.mutation.name, plan.mutation.server, current[index]);
        if (index < 0) current.push(effective); else current[index] = effective;
      } else if (plan.mutation.action === 'set_enabled') {
        if (index < 0) throw new PiviManagementError('validation_failed', `Unknown MCP server: ${plan.mutation.name}`);
        effective = { ...current[index]!, enabled: plan.mutation.enabled };
        current[index] = effective;
      } else {
        if (index < 0) throw new PiviManagementError('validation_failed', `Unknown MCP server: ${plan.mutation.name}`);
        current.splice(index, 1);
      }
      let saveResult: { revision: string; cleanupFailures: Array<{ target: string; message: string }> };
      this.throwIfAborted(signal);
      try {
        saveResult = await this.options.storage.saveIfRevision(current, expectedRevision);
      } catch (cause) {
        if (cause instanceof McpStorageStateChangedError) {
          throw new PiviManagementError('state_changed', 'MCP configuration changed after planning.', { cause });
        }
        throw new PiviManagementError('persistence_failed', 'Failed to save MCP configuration.', { cause });
      }
      // Durable config is committed. All later work is best-effort refresh/cleanup.
      const postCommitFailures = [...saveResult.cleanupFailures];
      const changedFromRemoteToStdio = !!previous
        && getMcpServerType(previous.config) !== 'stdio'
        && !!effective
        && getMcpServerType(effective.config) === 'stdio';
      const shouldRemoveOAuth = plan.mutation.action === 'remove' || (
        plan.mutation.action === 'upsert'
        && (
          changedFromRemoteToStdio
          || ('url' in plan.mutation.server && plan.mutation.server.oauth === false)
        )
      );
      if (shouldRemoveOAuth) {
        try {
          await this.options.removeOAuthArtifacts?.(plan.mutation.name);
        } catch (cause) {
          postCommitFailures.push({ target: `oauth:${plan.mutation.name}`, message: this.errorMessage(cause) });
        }
      }
      if (plan.mutation.action === 'remove' || shouldRemoveOAuth) {
        for (const id of listMcpAuthEntrySecretIds(plan.mutation.name)) {
          try {
            this.options.secretStorage?.setSecret(id, '');
          } catch (cause) {
            postCommitFailures.push({ target: id, message: this.errorMessage(cause) });
          }
        }
      }
      const directSecretKinds: Array<'bearer-token' | 'client-secret'> = [];
      if (changedFromRemoteToStdio || plan.mutation.action === 'remove') {
        directSecretKinds.push('bearer-token', 'client-secret');
      } else if (plan.mutation.action === 'upsert' && 'url' in plan.mutation.server) {
        if (plan.mutation.server.bearerToken?.source === 'clear') directSecretKinds.push('bearer-token');
        if (plan.mutation.server.oauth === false || plan.mutation.server.oauth?.clearClientSecret) {
          directSecretKinds.push('client-secret');
        }
      }
      for (const kind of directSecretKinds) {
        for (const id of listMcpServerSecretIds(plan.mutation.name, kind)) {
          try {
            this.options.secretStorage?.setSecret(id, '');
          } catch (cause) {
            postCommitFailures.push({ target: id, message: this.errorMessage(cause) });
          }
        }
      }
      let refreshed = true;
      try {
        await this.options.publish?.(current, plan.mutation.name);
      } catch (cause) {
        refreshed = false;
        postCommitFailures.push({ target: 'runtime', message: this.errorMessage(cause) });
      }
      let effectiveSummary: AgentMcpServerSummary | undefined;
      if (effective) {
        try {
          effectiveSummary = redactServer(effective, [], this.options.secretStorage);
        } catch (cause) {
          refreshed = false;
          postCommitFailures.push({ target: 'projection', message: this.errorMessage(cause) });
        }
      }
      return {
        revision: saveResult.revision,
        saved: true,
        refreshed,
        ...(effectiveSummary
          ? { effective: effectiveSummary }
          : effective
            ? {}
            : { removedName: plan.mutation.name }),
        ...(postCommitFailures.length ? {
          warnings: ['MCP configuration was saved, but some post-save cleanup or refresh work failed.'],
          refreshFailures: postCommitFailures.slice(0, 20),
        } : {}),
      };
    });
  }

  async replaceAll(servers: readonly ManagedMcpServer[], expectedRevision: string): Promise<McpManagementCommitResult> {
    return this.serialized(async () => {
      const loaded = await this.options.storage.loadRevisionedSnapshot();
      const current = loaded.servers;
      if (loaded.revision !== expectedRevision) {
        throw new PiviManagementError('state_changed', 'MCP configuration changed while Settings was open.');
      }
      let saveResult: { revision: string; cleanupFailures: Array<{ target: string; message: string }> };
      try {
        saveResult = await this.options.storage.saveIfRevision([...servers], expectedRevision);
      } catch (cause) {
        if (cause instanceof McpStorageStateChangedError) {
          throw new PiviManagementError('state_changed', 'MCP configuration changed while Settings was open.', { cause });
        }
        throw new PiviManagementError('persistence_failed', 'Failed to save MCP configuration.', { cause });
      }
      const cleanupFailures = [...saveResult.cleanupFailures];
      const nextNames = new Set(servers.map((server) => server.name));
      for (const removed of current.filter((server) => !nextNames.has(server.name))) {
        try {
          await this.options.removeOAuthArtifacts?.(removed.name);
        } catch (cause) {
          cleanupFailures.push({ target: `oauth:${removed.name}`, message: this.errorMessage(cause) });
        }
        for (const id of listMcpAuthEntrySecretIds(removed.name)) {
          try {
            this.options.secretStorage?.setSecret(id, '');
          } catch (cause) {
            cleanupFailures.push({ target: id, message: this.errorMessage(cause) });
          }
        }
      }
      let refreshed = true;
      try {
        await this.options.publish?.(servers, '*');
      } catch (cause) {
        refreshed = false;
        cleanupFailures.push({ target: 'runtime', message: this.errorMessage(cause) });
      }
      return {
        revision: saveResult.revision,
        saved: true,
        refreshed,
        ...(cleanupFailures.length ? {
          warnings: ['MCP configuration was saved, but some post-save cleanup or refresh work failed.'],
          refreshFailures: cleanupFailures.slice(0, 20),
        } : {}),
      };
    });
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private toTestResult(name: string, result: McpTestResult): PiviMcpTestResult {
    const authenticationRequired = !result.success
      && /\b(401|403|unauthori[sz]ed|authentication required|not authenticated)\b/i.test(result.error ?? '');
    const error = result.error
      ? authenticationRequired
        ? 'Authentication required.'
        : /\b(time(?:d? out)|timeout)\b/i.test(result.error)
          ? 'Connection timed out.'
          : /\b(cancel(?:led)?|abort(?:ed)?)\b/i.test(result.error)
            ? 'Connection cancelled.'
            : /\b(invalid|missing|malformed|unsupported|configuration|executable)\b/i.test(result.error)
              ? 'Invalid server configuration.'
              : 'Connection failed.'
      : undefined;
    return {
      name,
      success: result.success,
      ...(authenticationRequired ? { authenticationRequired: true } : {}),
      ...(result.serverVersion ? { serverVersion: result.serverVersion } : {}),
      ...(result.tools.length ? { tools: result.tools.map(({ name: toolName, description }) => ({ name: toolName, ...(description ? { description } : {}) })) } : {}),
      ...(error ? { error } : {}),
    };
  }

  private errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : 'Unknown failure';
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new PiviManagementError('cancelled', 'MCP management change was cancelled.');
    }
  }

  private hydrateDirectSecrets(server: ManagedMcpServer): void {
    const read = (kind: 'bearer-token' | 'client-secret') => {
      for (const id of listMcpServerSecretIds(server.name, kind)) {
        const value = this.options.secretStorage?.getSecret(id);
        if (value) return value;
      }
      return undefined;
    };
    if (server.auth === 'bearer') server.bearerToken = read('bearer-token');
    if (server.oauth && typeof server.oauth === 'object') {
      const clientSecret = read('client-secret');
      if (clientSecret) server.oauth = { ...server.oauth, clientSecret };
    }
  }
}
