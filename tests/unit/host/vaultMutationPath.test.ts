import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  assertAgentManagedPathMutationAllowed,
  normalizePathForVault,
  requireAgentVaultMutationPath,
  requireVaultRelativeMutationPath,
} from '@pivi/obsidian-host/path';

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(process, 'platform', descriptor);
    }
  }
}

describe('requireVaultRelativeMutationPath', () => {
  let root: string;
  let vaultPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-mutation-'));
    vaultPath = path.join(root, 'vault');
    fs.mkdirSync(path.join(vaultPath, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, 'notes', 'a.md'), 'hello');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('accepts nested vault-relative paths', () => {
    expect(requireVaultRelativeMutationPath('notes/a.md', vaultPath)).toBe('notes/a.md');
    expect(requireVaultRelativeMutationPath('notes/./b.md', vaultPath)).toBe('notes/b.md');
  });

  it('rejects empty, root, traversal, and NUL', () => {
    expect(() => requireVaultRelativeMutationPath('', vaultPath)).toThrow(/non-empty/i);
    expect(() => requireVaultRelativeMutationPath('.', vaultPath)).toThrow(/vault root/i);
    expect(() => requireVaultRelativeMutationPath('../escape.md', vaultPath)).toThrow(/traversal/i);
    expect(() => requireVaultRelativeMutationPath('notes/../outside.md', vaultPath)).toThrow(/traversal/i);
    expect(() => requireVaultRelativeMutationPath('notes/a\0.md', vaultPath)).toThrow(/NUL/i);
  });

  it('rejects absolute POSIX paths', () => {
    expect(() => requireVaultRelativeMutationPath('/tmp/evil.md', vaultPath)).toThrow(/vault-relative/i);
  });

  it('rejects Windows drive, UNC, and device paths', () => {
    withPlatform('win32', () => {
      expect(() => requireVaultRelativeMutationPath('C:\\Users\\x\\note.md', vaultPath)).toThrow(/vault-relative/i);
      expect(() => requireVaultRelativeMutationPath('C:note.md', vaultPath)).toThrow(/vault-relative/i);
      expect(() => requireVaultRelativeMutationPath('\\\\server\\share\\note.md', vaultPath)).toThrow(/vault-relative/i);
      expect(() => requireVaultRelativeMutationPath('\\\\.\\pipe\\x', vaultPath)).toThrow(/vault-relative/i);
    });
  });

  it('rejects duplicate separators that look like UNC', () => {
    expect(() => requireVaultRelativeMutationPath('notes//a.md', vaultPath)).toThrow(/vault-relative|separator/i);
  });

  it('rejects POSIX backslashes instead of changing the validated target', () => {
    withPlatform('linux', () => {
      expect(() => requireVaultRelativeMutationPath('notes\\a.md', vaultPath))
        .toThrow(/backslash|separator/i);
    });
  });

  it('contains creation beneath a symlinked parent that escapes the vault', () => {
    if (process.platform === 'win32') {
      return;
    }
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    const link = path.join(vaultPath, 'linked');
    fs.symlinkSync(outside, link);
    expect(() => requireVaultRelativeMutationPath('linked/new.md', vaultPath)).toThrow(/escapes/i);
  });

  it('contains an existing symlink target outside the vault', () => {
    if (process.platform === 'win32') {
      return;
    }
    const outsideFile = path.join(root, 'outside.md');
    fs.writeFileSync(outsideFile, 'x');
    const link = path.join(vaultPath, 'escape.md');
    fs.symlinkSync(outsideFile, link);
    expect(() => requireVaultRelativeMutationPath('escape.md', vaultPath)).toThrow(/escapes/i);
  });

  it('preserves display normalization separately from mutation validation', () => {
    const absoluteOutside = path.join(root, 'sibling', 'note.md');
    fs.mkdirSync(path.dirname(absoluteOutside), { recursive: true });
    fs.writeFileSync(absoluteOutside, 'x');
    expect(normalizePathForVault(absoluteOutside, vaultPath)).toBe(absoluteOutside.replace(/\\/g, '/'));
    expect(() => requireVaultRelativeMutationPath(absoluteOutside, vaultPath)).toThrow(/vault-relative/i);
  });

  it('preserves case on case-sensitive platforms and still contains escapes', () => {
    withPlatform('linux', () => {
      expect(requireVaultRelativeMutationPath('Notes/A.md', vaultPath)).toBe('Notes/A.md');
    });
  });
});

describe('assertAgentManagedPathMutationAllowed', () => {
  // Mechanically mirrors every name passed to withOperationRoot() in
  // vaultSkillsService; changing that production inventory requires updating
  // this policy-contract table.
  const vaultSkillsOperationRoots = [
    '.pivi/skills-install-',
    '.pivi/skills-default-update-',
    '.pivi/skills-remove-',
    '.pivi/skills-update-all-',
    '.pivi/skills-update-',
  ] as const;

  const blockedDirect: Array<{ path: string; tool: string }> = [
    { path: '.pivi/mcp.json', tool: 'pivi_mcp' },
    { path: '.pivi/mcp.json.corrupt-abc', tool: 'pivi_mcp' },
    { path: '.pivi/mcp.json.tmp-1a2b', tool: 'pivi_mcp' },
    { path: '.pivi/mcp.json.bak-xyz', tool: 'pivi_mcp' },
    { path: '.pivi/mcp-oauth', tool: 'pivi_mcp' },
    { path: '.pivi/mcp-oauth/server/token.json', tool: 'pivi_mcp' },
    { path: '.pivi/skills', tool: 'pivi_skills' },
    { path: '.pivi/skills/obsidian-markdown/SKILL.md', tool: 'pivi_skills' },
    { path: '.pivi/skills/.publish-x-1', tool: 'pivi_skills' },
    { path: '.pivi/skills/.backup-x-1', tool: 'pivi_skills' },
    { path: '.pivi/skills-staging/op-1/skill', tool: 'pivi_skills' },
    { path: '.pivi/skills-install-op/skills/demo', tool: 'pivi_skills' },
    { path: '.pivi/skills-list-op/skills-lock.json', tool: 'pivi_skills' },
    { path: '.pivi/skills-remove-op', tool: 'pivi_skills' },
    { path: '.pivi/skills-remove-op/skills/demo/SKILL.md', tool: 'pivi_skills' },
    { path: '.pivi/skills-update-op/.agents/skills/demo', tool: 'pivi_skills' },
    { path: '.pivi/skills-update-all-op/.pivi/skills/demo', tool: 'pivi_skills' },
    { path: '.pivi/skills-default-update-op/skills/demo', tool: 'pivi_skills' },
    { path: '.pivi/.skills-transaction-123', tool: 'pivi_skills' },
    { path: '.pivi/.skills-transaction-123/next', tool: 'pivi_skills' },
    { path: '.pivi/.skills-transaction-123/previous/skills', tool: 'pivi_skills' },
    { path: '.pivi/.skills-publication-op/demo', tool: 'pivi_skills' },
    { path: '.pivi/.skills-backup-op/demo', tool: 'pivi_skills' },
    { path: '.pivi/.agents/skills/foo/SKILL.md', tool: 'pivi_skills' },
    { path: '.pivi/.cursor/skills/bar/SKILL.md', tool: 'pivi_skills' },
    { path: '.pivi/skills-lock.json', tool: 'pivi_skills' },
    { path: '.pivi/.skills.json', tool: 'pivi_skills' },
    { path: 'skills-lock.json', tool: 'pivi_skills' },
    { path: '.skills.json', tool: 'pivi_skills' },
    { path: '.pivi/commands', tool: 'pivi_commands' },
    { path: '.pivi/commands/summarize.md', tool: 'pivi_commands' },
    { path: '.pivi/templates/legacy.md', tool: 'pivi_commands' },
    { path: '.pivi/.commands-removal-abc', tool: 'pivi_commands' },
    { path: '.pivi/.commands-removal-abc/manifest.json', tool: 'pivi_commands' },
    { path: '.pivi/.commands-removal-abc/canonical.md', tool: 'pivi_commands' },
  ];

  const allowedDirect = [
    'notes/a.md',
    '.pivi/settings.json',
    '.pivi/sessions/device/chat.jsonl',
    '.pivi/SYSTEM.md',
    '.pivi/tab-manager-state.json',
    '.pivi/auth.json',
    '.agents/skills/outside/SKILL.md',
    'skills/unrelated.md',
  ];

  const blockedRecursiveAncestors: Array<{ path: string; tool: string }> = [
    { path: '.pivi', tool: 'pivi_mcp' },
    { path: '.pivi/.agents', tool: 'pivi_skills' },
    { path: '.pivi/.cursor', tool: 'pivi_skills' },
    { path: '.pivi/skills-remove-op', tool: 'pivi_skills' },
    { path: '.pivi/.skills-transaction-123', tool: 'pivi_skills' },
  ];

  it.each(blockedDirect)('direct mode blocks $path and names $tool', ({ path: target, tool }) => {
    expect(() => assertAgentManagedPathMutationAllowed(target, { mode: 'direct' }))
      .toThrow(new RegExp(`${tool}`));
    expect(() => assertAgentManagedPathMutationAllowed(target, { mode: 'direct' }))
      .toThrow(/managed by Pivi/i);
  });

  it.each(allowedDirect)('direct mode allows unrelated path %s', (target) => {
    expect(() => assertAgentManagedPathMutationAllowed(target, { mode: 'direct' })).not.toThrow();
  });

  it.each(vaultSkillsOperationRoots)(
    'blocks actual operation root %s and a descendant',
    (rootPrefix) => {
      const root = `${rootPrefix}mechanical-test`;
      expect(() => assertAgentManagedPathMutationAllowed(root, { mode: 'direct' }))
        .toThrow(/pivi_skills/);
      expect(() => assertAgentManagedPathMutationAllowed(`${root}/nested/SKILL.md`, { mode: 'direct' }))
        .toThrow(/pivi_skills/);
    },
  );

  it('direct mode allows ancestors that recursive mode blocks', () => {
    expect(() => assertAgentManagedPathMutationAllowed('.pivi', { mode: 'direct' })).not.toThrow();
    expect(() => assertAgentManagedPathMutationAllowed('.pivi', { mode: 'recursive' }))
      .toThrow(/pivi_mcp/);
  });

  it.each(blockedRecursiveAncestors)(
    'recursive mode blocks ancestor $path with $tool guidance',
    ({ path: target, tool }) => {
      expect(() => assertAgentManagedPathMutationAllowed(target, { mode: 'recursive' }))
        .toThrow(new RegExp(tool));
    },
  );

  it('recursive mode still blocks exact managed paths', () => {
    expect(() => assertAgentManagedPathMutationAllowed('.pivi/commands/x.md', { mode: 'recursive' }))
      .toThrow(/pivi_commands/);
  });
});

describe('requireAgentVaultMutationPath', () => {
  let root: string;
  let vaultPath: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-agent-mutation-'));
    vaultPath = path.join(root, 'vault');
    fs.mkdirSync(path.join(vaultPath, 'notes'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns canonical path for ordinary notes', () => {
    expect(requireAgentVaultMutationPath('notes/./a.md', vaultPath)).toBe('notes/a.md');
  });

  it('runs containment before managed-path policy', () => {
    expect(() => requireAgentVaultMutationPath('../escape.md', vaultPath)).toThrow(/traversal/i);
  });

  it('blocks managed write targets after containment', () => {
    expect(() => requireAgentVaultMutationPath('.pivi/mcp.json', vaultPath))
      .toThrow(/pivi_mcp/);
  });

  it('blocks recursive delete/move of managed ancestors', () => {
    expect(() => requireAgentVaultMutationPath('.pivi', vaultPath, { mode: 'recursive' }))
      .toThrow(/managed by Pivi/);
  });

  it('blocks a recursive move source ancestor while allowing an ordinary destination', () => {
    expect(() => requireAgentVaultMutationPath('.pivi', vaultPath, { mode: 'recursive' }))
      .toThrow(/pivi_mcp/);
    expect(requireAgentVaultMutationPath('archive/pivi-backup', vaultPath, { mode: 'direct' }))
      .toBe('archive/pivi-backup');
  });

  it('allows move destinations outside managed namespaces', () => {
    expect(requireAgentVaultMutationPath('notes/moved.md', vaultPath, { mode: 'direct' }))
      .toBe('notes/moved.md');
  });

  it('blocks move destination into managed commands namespace', () => {
    expect(() => requireAgentVaultMutationPath('.pivi/commands/new.md', vaultPath, { mode: 'direct' }))
      .toThrow(/pivi_commands/);
  });

  it('blocks vault-local symlink aliases into managed namespaces', () => {
    if (process.platform === 'win32') return;
    fs.mkdirSync(path.join(vaultPath, '.pivi', 'skills'), { recursive: true });
    fs.symlinkSync(path.join(vaultPath, '.pivi', 'skills'), path.join(vaultPath, 'skill-alias'));
    expect(() => requireAgentVaultMutationPath('skill-alias/demo/SKILL.md', vaultPath))
      .toThrow(/pivi_skills/);
  });
});
