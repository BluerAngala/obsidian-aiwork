import { readFileSync } from 'fs';

const forbiddenPatterns = [
  { label: 'dynamic script element creation', pattern: /createElement\(["']script["']\)/ },
  { label: 'dynamic Function construction', pattern: /new Function\s*\(/ },
  // The community review static scan treats string references to the plugin's
  // own files combined with file writes as a self-update signal. Pivi never
  // writes its plugin directory, so keep these literals out of the bundle.
  { label: 'plugin self-file reference "manifest.json"', pattern: /["'`][^"'`\n]*manifest\.json[^"'`\n]*["'`]/ },
  { label: 'plugin self-file reference "main.js"', pattern: /["'`][^"'`\n]*main\.js["'`]/ },
];

export const assertCommunityAudit = {
  name: 'assert-community-audit',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      const output = result.outputFiles?.find(file => file.path.endsWith('main.js'))?.text
        ?? readFileSync(build.initialOptions.outfile, 'utf8');
      const findings = forbiddenPatterns
        .filter(({ pattern }) => pattern.test(output))
        .map(({ label }) => ({
          text: `Community audit failed: found ${label} in main.js`,
        }));
      result.errors.push(...findings);
    });
  },
};
