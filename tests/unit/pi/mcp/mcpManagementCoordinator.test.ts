import { McpManagementCoordinator } from '@pivi/pivi-agent-core/mcp/mcpManagementCoordinator';
import { listMcpServerSecretIds, type McpStorage } from '@pivi/pivi-agent-core/mcp/mcpStorage';
import { listMcpAuthEntrySecretIds } from '@pivi/pivi-agent-core/mcp/oauth/mcpSecretAuthStore';
import type { AppMcpToolProvider } from '@pivi/pivi-agent-core/mcp/ports';
import type { ManagedMcpServer } from '@pivi/pivi-agent-core/mcp/types';
import type { SyncSecretStore } from '@pivi/pivi-agent-core/ports';

const server: ManagedMcpServer = {
  name: 'sentinel',
  config: { type: 'http', url: 'https://safe.example.test/mcp' },
  enabled: true,
  contextSaving: true,
};

describe('McpManagementCoordinator', () => {
  it('never projects raw tester diagnostics into the Agent result', async () => {
    const sentinel = 'TOKEN_SENTINEL at https://private.example/token from /Users/private/key';
    const coordinator = new McpManagementCoordinator({
      storage: {
        loadSnapshot: jest.fn(async () => [{ ...server }]),
      } as unknown as McpStorage,
      toolProvider: {
        getCachedTools: () => [],
        cacheTools: jest.fn(),
      } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn(async () => ({ success: false, tools: [], error: sentinel })) },
    });

    const result = await coordinator.test('sentinel');

    expect(result).toEqual({ name: 'sentinel', success: false, error: 'Connection failed.' });
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it('cleans remote OAuth state and direct secrets after a remote-to-stdio publication', async () => {
    const remote: ManagedMcpServer = {
      ...server,
      auth: 'oauth',
      oauth: { clientId: 'client-id' },
      config: {
        type: 'http',
        url: 'https://safe.example.test/mcp',
        headers: { Authorization: { kind: 'secret' } },
      },
    };
    const values = new Map<string, string>();
    for (const id of [
      ...listMcpAuthEntrySecretIds(server.name),
      ...listMcpServerSecretIds(server.name, 'bearer-token'),
      ...listMcpServerSecretIds(server.name, 'client-secret'),
    ]) values.set(id, 'old-secret');
    const secretStorage: SyncSecretStore = {
      getSecret: id => values.get(id) ?? null,
      setSecret: (id, value) => { values.set(id, value); },
      listSecrets: prefix => [...values.keys()].filter(id => !prefix || id.startsWith(prefix)),
    };
    const saveIfRevision = jest.fn(async () => ({ revision: 'next', cleanupFailures: [] }));
    const removeOAuthArtifacts = jest.fn(async () => undefined);
    const storage = {
      loadRevisionedSnapshot: jest.fn(async () => ({ servers: [remote], revision: 'revision' })),
      saveIfRevision,
    } as unknown as McpStorage;
    const coordinator = new McpManagementCoordinator({
      storage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
      secretStorage,
      removeOAuthArtifacts,
    });
    const plan = await coordinator.plan({
      action: 'upsert',
      name: server.name,
      server: { command: 'node', env: { API_KEY: { source: 'systemEnvironment', variable: 'MCP_KEY' } } },
    });

    await coordinator.commit(plan);

    expect(saveIfRevision).toHaveBeenCalledWith([
      expect.objectContaining({ name: server.name, config: expect.objectContaining({ command: 'node' }) }),
    ], 'revision');
    expect(removeOAuthArtifacts).toHaveBeenCalledWith(server.name);
    for (const id of [
      ...listMcpAuthEntrySecretIds(server.name),
      ...listMcpServerSecretIds(server.name, 'bearer-token'),
      ...listMcpServerSecretIds(server.name, 'client-secret'),
    ]) expect(values.get(id)).toBe('');
    expect(saveIfRevision.mock.invocationCallOrder[0]).toBeLessThan(removeOAuthArtifacts.mock.invocationCallOrder[0]!);
  });

  it('reuses the save revision and does not re-read after durable commit', async () => {
    const saveIfRevision = jest.fn(async () => ({ revision: 'published-rev', cleanupFailures: [] }));
    const loadRevisionedSnapshot = jest.fn(async () => ({ servers: [{ ...server }], revision: 'revision' }));
    const coordinator = new McpManagementCoordinator({
      storage: { loadRevisionedSnapshot, saveIfRevision } as unknown as McpStorage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
    });
    const plan = await coordinator.plan({ action: 'set_enabled', name: server.name, enabled: false });

    const result = await coordinator.commit(plan);

    expect(result).toMatchObject({
      revision: 'published-rev',
      saved: true,
      refreshed: true,
    });
    expect(loadRevisionedSnapshot).toHaveBeenCalledTimes(2); // plan + commit CAS only
  });

  it('returns saved:true refreshed:false when post-save SecretStorage projection fails', async () => {
    const saveIfRevision = jest.fn(async () => ({ revision: 'published-rev', cleanupFailures: [] }));
    const secretStorage: SyncSecretStore = {
      getSecret: () => {
        throw new Error('keychain unavailable');
      },
      setSecret: () => undefined,
      listSecrets: () => [],
    };
    const coordinator = new McpManagementCoordinator({
      storage: {
        loadRevisionedSnapshot: jest.fn(async () => ({ servers: [{ ...server }], revision: 'revision' })),
        saveIfRevision,
      } as unknown as McpStorage,
      toolProvider: { getCachedTools: () => [], cacheTools: jest.fn() } as unknown as AppMcpToolProvider,
      tester: { testServer: jest.fn() },
      secretStorage,
    });
    const plan = await coordinator.plan({
      action: 'upsert',
      name: server.name,
      server: { type: 'http', url: 'https://safe.example.test/mcp', auth: 'bearer' },
    });

    const result = await coordinator.commit(plan);

    expect(result).toMatchObject({
      revision: 'published-rev',
      saved: true,
      refreshed: false,
      warnings: ['MCP configuration was saved, but some post-save cleanup or refresh work failed.'],
    });
    expect(result.effective).toBeUndefined();
    expect(result.refreshFailures).toEqual([
      expect.objectContaining({ target: 'projection', message: 'keychain unavailable' }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/bearer|secret|token/i);
  });
});
