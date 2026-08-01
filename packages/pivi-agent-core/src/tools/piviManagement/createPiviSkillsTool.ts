import { TOOL_PIVI_SKILLS } from '../obsidianToolNames';
import { textResult } from '../toolResult';
import type { ToolSpec } from '../toolSpec';
import type { PiviManagementPort } from './port';
import { PIVI_SKILLS_PARAMETERS } from './schemas';
import { parsePiviSkillsInput } from './validate';

export function createPiviSkillsTool(port: PiviManagementPort): ToolSpec {
  return {
    name: TOOL_PIVI_SKILLS,
    label: 'Pivi Skills',
    description: [
      'Query and manage Pivi vault Skills only through the pinned skills package workflow.',
      'Actions: list, list_remote, install, set_enabled, update, update_all, remove.',
      'Do not supply Skill bodies, files, SKILL.md content, source trees, or destinations.',
      'Mutations require one sidebar confirmation.',
    ].join(' '),
    parameters: PIVI_SKILLS_PARAMETERS,
    promptUsage: {
      summary: 'Query and manage vault Skills only through the pinned skills package; never supply Skill bodies, files, SKILL.md, source trees, or destinations',
      parameters: '`action` required list|list_remote|install|set_enabled|update|update_all|remove; `source` required for list_remote/install; `skillNames?` optional install filter; `name` required for set_enabled/update/remove; `enabled` required for set_enabled.',
    },
    executionMode: 'sequential',
    metadata: { displayKind: 'other' },
    async execute(_id, params, signal) {
      const input = parsePiviSkillsInput(params);
      const result = await port.executeSkills(input, signal);
      return textResult(JSON.stringify(result, null, 2), { action: input.action });
    },
  };
}
