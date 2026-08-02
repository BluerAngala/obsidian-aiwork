import { createRequire } from 'node:module';
import { join } from 'node:path';

const nodeRequire = createRequire(join(process.cwd(), 'package.json'));
const {
  parseConventionalCommit,
  renderBetaReleaseNotes,
} = nodeRequire('./scripts/generate-beta-release-notes');

describe('generate-beta-release-notes', () => {
  it('groups conventional commits and excludes release preparation', () => {
    const notes = renderBetaReleaseNotes({
      fromTag: '0.17.1-beta.3',
      toTag: '0.17.1-beta.4',
      repository: 'shuuul/obsidian-pivi',
      commits: [
        { hash: '111111111111', subject: 'fix(engine): restore provider requests' },
        { hash: '222222222222', subject: 'feat(chat): add session mentions' },
        { hash: '333333333333', subject: 'chore(deps): bump pi-ai' },
        { hash: '444444444444', subject: 'chore(release): prepare 0.17.1-beta.4' },
      ],
    });

    expect(notes).toContain('## Features');
    expect(notes).toContain('**chat:** add session mentions');
    expect(notes).toContain('## Bug Fixes');
    expect(notes).toContain('**engine:** restore provider requests');
    expect(notes).toContain('## Dependencies');
    expect(notes).toContain('**deps:** bump pi-ai');
    expect(notes).not.toContain('prepare 0.17.1-beta.4');
    expect(notes).toContain('/compare/0.17.1-beta.3...0.17.1-beta.4');
  });

  it('keeps uncategorized conventional commits and marks breaking changes', () => {
    expect(parseConventionalCommit('abcdef123', 'refactor(core)!: replace API')).toEqual(
      expect.objectContaining({
        section: 'other',
        breaking: true,
        scope: 'core',
        summary: 'replace API',
      }),
    );
    expect(parseConventionalCommit('abcdef123', 'Merge branch main')).toBeUndefined();
  });
});
