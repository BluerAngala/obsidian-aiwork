import {
  matchBashCommandAllowlist,
} from '@pivi/obsidian-tools';
import { tokenizeBashArgv } from '@pivi/pivi-agent-core/tools';

describe('bashAllowlist shell-aware matching', () => {
  it('tokenizes quoted argv literally', () => {
    expect(tokenizeBashArgv(`echo "a b" 'c d'`)).toEqual(['echo', 'a b', 'c d']);
  });

  it('matches exact commands and argument prefixes', () => {
    expect(matchBashCommandAllowlist('git status', ['git'])).toBe(true);
    expect(matchBashCommandAllowlist('git', ['git'])).toBe(true);
    expect(matchBashCommandAllowlist('npm run build --silent', ['npm run build'])).toBe(true);
  });

  it('rejects commands outside the allowlist prefix', () => {
    expect(matchBashCommandAllowlist('npm install', ['npm run build'])).toBe(false);
    expect(matchBashCommandAllowlist('npm run build:evil', ['npm run build'])).toBe(false);
  });

  it.each([
    'git status; rm -rf .',
    'git status && rm -rf .',
    'git status || rm -rf .',
    'git status | cat',
    'git status < input',
    'git status > output',
    'git status 2>> output',
    'git `status`',
    'git $(status)',
    'git status\nrm -rf .',
    'git status\r rm -rf .',
    'git status\u0000rm',
  ])('rejects active shell syntax in %p', (command) => {
    expect(matchBashCommandAllowlist(command, ['git'])).toBe(false);
  });

  it('allows shell metacharacters only when single-quoted as literal argv', () => {
    expect(matchBashCommandAllowlist("git show ';'", ['git show'])).toBe(true);
  });

  it('never applies POSIX prefixes to cmd.exe or unknown shells', () => {
    expect(matchBashCommandAllowlist('type \\& whoami', ['type'], 'C:\\Windows\\System32\\cmd.exe')).toBe(false);
    expect(matchBashCommandAllowlist('echo %PATH%', ['echo'], 'cmd.exe')).toBe(false);
    expect(matchBashCommandAllowlist('echo foo ^& whoami', ['echo'], 'cmd.exe')).toBe(false);
    expect(matchBashCommandAllowlist('git status', ['git'], '/opt/custom-shell')).toBe(false);
  });

  it('distinguishes tagged exact grants from prefixes, including unsafe exact commands', () => {
    expect(matchBashCommandAllowlist('printf x | cat', ['exact: printf x | cat'], '/bin/zsh')).toBe(true);
    expect(matchBashCommandAllowlist('printf x | wc', ['exact: printf x | cat'], '/bin/zsh')).toBe(false);
    expect(matchBashCommandAllowlist('git status', ['exact: git'], '/bin/zsh')).toBe(false);
    expect(matchBashCommandAllowlist('git status', ['prefix: "git"'], '/bin/zsh')).toBe(true);
    expect(matchBashCommandAllowlist('printf x | cat', ['exact: printf x | cat'], 'cmd.exe')).toBe(true);
  });

  it('preserves POSIX double-quote backslashes instead of over-unescaping', () => {
    expect(tokenizeBashArgv('printf "a\\qb"')).toEqual(['printf', 'a\\qb']);
    expect(tokenizeBashArgv('printf "a\\\\b"')).toEqual(['printf', 'a\\b']);
  });
});
