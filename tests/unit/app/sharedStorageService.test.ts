import { SharedStorageService } from '@pivi/obsidian-host/storage/sharedStorageService';

function createMemoryAdapter() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  return {
    files,
    adapter: {
      exists: jest.fn(async (path: string) => files.has(path) || folders.has(path)),
      mkdir: jest.fn(async (path: string) => { folders.add(path); }),
      read: jest.fn(async (path: string) => {
        if (!files.has(path)) {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }
        return files.get(path) as string;
      }),
      write: jest.fn(async (path: string, content: string) => { files.set(path, content); }),
    },
  };
}

function createPlugin() {
  const { adapter, files } = createMemoryAdapter();
  return {
    files,
    plugin: {
      app: { vault: { adapter } },
      loadData: jest.fn().mockResolvedValue({}),
      saveData: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('SharedStorageService tab manager state', () => {
  it('migrates legacy deleted-session paths with a fresh recovery window', async () => {
    const { plugin } = createPlugin();
    const deletedSessionFiles = ['.pivi/sessions/legacy.jsonl'];
    plugin.loadData.mockResolvedValue({ deletedSessionFiles });
    const storage = new SharedStorageService(plugin as never);
    const before = Date.now();

    const records = await storage.getDeletedSessionFiles();

    expect(records).toHaveLength(1);
    expect(records[0]?.sessionFile).toBe(deletedSessionFiles[0]);
    expect(records[0]?.deletedAt).toBeGreaterThanOrEqual(before);
    expect(records[0]?.deletedAt).toBeLessThanOrEqual(Date.now());
    expect(plugin.saveData).toHaveBeenCalledWith({ deletedSessionFiles: records });
  });

  it('does not treat a deleted-session queue read failure as an empty queue', async () => {
    const { plugin } = createPlugin();
    plugin.loadData.mockRejectedValue(new Error('read failed'));
    const storage = new SharedStorageService(plugin as never);

    await expect(storage.getDeletedSessionFiles()).rejects.toThrow('read failed');
  });

  it('surfaces tab layout write failures', async () => {
    const { plugin } = createPlugin();
    const storage = new SharedStorageService(plugin as never);
    plugin.app.vault.adapter.write.mockRejectedValue(new Error('write failed'));

    await expect(storage.setTabManagerState({ openTabs: [], activeTabId: null }))
      .rejects.toThrow('write failed');
  });

  it('writes tab manager state to .pivi for vault sync only', async () => {
    const { plugin, files } = createPlugin();
    const storage = new SharedStorageService(plugin as never);
    const state = {
      activeTabId: 'tab-1',
      openTabs: [{ tabId: 'tab-1', sessionFile: '.pivi/sessions/a.jsonl' }],
    };

    await storage.setTabManagerState(state);

    expect(JSON.parse(files.get('.pivi/tab-manager-state.json') ?? '')).toEqual(state);
    expect(plugin.saveData).not.toHaveBeenCalled();
  });

  it('prefers .pivi tab manager state over legacy plugin data', async () => {
    const { plugin, files } = createPlugin();
    const storage = new SharedStorageService(plugin as never);
    const vaultState = {
      activeTabId: 'vault-tab',
      openTabs: [{ tabId: 'vault-tab', sessionFile: '.pivi/sessions/vault.jsonl' }],
    };
    plugin.loadData.mockResolvedValue({
      tabManagerState: {
        activeTabId: 'legacy-tab',
        openTabs: [{ tabId: 'legacy-tab' }],
      },
    });
    files.set('.pivi/tab-manager-state.json', JSON.stringify(vaultState));

    await expect(storage.getTabManagerState()).resolves.toEqual(vaultState);
  });

  it('migrates legacy plugin tab manager state into .pivi and clears data.json key', async () => {
    const { plugin, files } = createPlugin();
    const storage = new SharedStorageService(plugin as never);
    const legacyState = {
      activeTabId: 'legacy-tab',
      openTabs: [{ tabId: 'legacy-tab', isArchived: true }],
    };
    const pluginData: Record<string, unknown> = {
      tabManagerState: legacyState,
      deletedSessionFiles: ['.pivi/sessions/old.jsonl'],
    };
    plugin.loadData.mockImplementation(async () => ({ ...pluginData }));
    plugin.saveData.mockImplementation(async (data: Record<string, unknown>) => {
      Object.keys(pluginData).forEach((key) => delete pluginData[key]);
      Object.assign(pluginData, data);
    });

    await expect(storage.getTabManagerState()).resolves.toEqual(legacyState);
    expect(JSON.parse(files.get('.pivi/tab-manager-state.json') ?? '')).toEqual(legacyState);
    expect(plugin.saveData).toHaveBeenCalled();
    const saved = plugin.saveData.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(saved).not.toHaveProperty('tabManagerState');
    expect(saved.deletedSessionFiles).toEqual(['.pivi/sessions/old.jsonl']);
  });
});
