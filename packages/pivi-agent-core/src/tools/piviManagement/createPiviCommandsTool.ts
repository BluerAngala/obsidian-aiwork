import { TOOL_PIVI_COMMANDS } from '../obsidianToolNames';
import { textResult } from '../toolResult';
import type { ToolSpec } from '../toolSpec';
import type { PiviManagementPort } from './port';
import { PIVI_COMMANDS_PARAMETERS } from './schemas';
import { parsePiviCommandsInput } from './validate';

export function createPiviCommandsTool(port: PiviManagementPort): ToolSpec {
  return {
    name: TOOL_PIVI_COMMANDS,
    label: 'Pivi Commands',
    description: [
      'Query and manage vault-local Pivi slash Commands (.pivi/commands/).',
      'Actions: list, get, upsert, remove, move.',
      'Agent input is limited to id/name/description/argumentHint/icon/content;',
      'integration keys and identity policy are Pivi-owned.',
      'upsert, remove, and move require catalogRevision from a prior list/get.',
      'Mutations require one sidebar confirmation.',
    ].join(' '),
    parameters: PIVI_COMMANDS_PARAMETERS,
    executionMode: 'sequential',
    metadata: { displayKind: 'other' },
    async execute(_id, params, signal) {
      const input = parsePiviCommandsInput(params);
      const result = await port.executeCommands(input, signal);
      return textResult(JSON.stringify(result, null, 2), { action: input.action });
    },
  };
}
