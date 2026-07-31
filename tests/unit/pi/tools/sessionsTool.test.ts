import { createSessionsTool, type ObsidianToolDeps } from '@pivi/obsidian-tools';

function makeDeps() {
  const read = jest.fn(async () => '## User\n\nQuestion\n\n## Agent\n\nAnswer');
  const listDeleted = jest.fn(async () => [{
    sessionFile: '.pivi/sessions/deleted.jsonl',
    deletedAt: 100,
    expiresAt: 200,
    retentionDays: 30,
  }]);
  const restore = jest.fn(async (sessionFile: string) => ({
    sessionId: 'session-1',
    title: 'Recovered session',
    sessionFile,
  }));
  const deps = {
    sessionRecovery: { read, listDeleted, restore },
  } as unknown as ObsidianToolDeps;
  return { deps, read, listDeleted, restore };
}

function getText(result: unknown): string {
  const content = (result as { content: Array<{ text: string }> }).content;
  return content[0]?.text ?? '';
}

describe('createSessionsTool', () => {
  it('reads one durable session by exact file path', async () => {
    const { deps, read } = makeDeps();

    const result = await createSessionsTool(deps).execute('call-1', {
      action: 'read',
      sessionFile: '.pivi/sessions/active.jsonl',
    });

    expect(read).toHaveBeenCalledWith('.pivi/sessions/active.jsonl');
    expect(getText(result)).toBe('## User\n\nQuestion\n\n## Agent\n\nAnswer');
  });

  it('lists recoverable sessions with their expiry metadata', async () => {
    const { deps, listDeleted } = makeDeps();

    const result = await createSessionsTool(deps).execute('call-1', { action: 'list_deleted' });

    expect(listDeleted).toHaveBeenCalledTimes(1);
    expect(JSON.parse(getText(result))).toEqual({
      sessions: [{
        sessionFile: '.pivi/sessions/deleted.jsonl',
        deletedAt: 100,
        expiresAt: 200,
        retentionDays: 30,
      }],
    });
  });

  it('restores one queued session by exact file path', async () => {
    const { deps, restore } = makeDeps();

    const result = await createSessionsTool(deps).execute('call-1', {
      action: 'restore',
      sessionFile: '.pivi/sessions/deleted.jsonl',
    });

    expect(restore).toHaveBeenCalledWith('.pivi/sessions/deleted.jsonl');
    expect(JSON.parse(getText(result))).toMatchObject({
      sessionId: 'session-1',
      title: 'Recovered session',
    });
  });

  it('rejects an invalid action or a restore without sessionFile', async () => {
    const { deps } = makeDeps();
    const tool = createSessionsTool(deps);

    await expect(tool.execute('call-1', { action: 'unknown' }))
      .rejects.toThrow('Invalid sessions action');
    await expect(tool.execute('call-2', { action: 'restore' }))
      .rejects.toThrow('sessionFile is required');
  });
});
