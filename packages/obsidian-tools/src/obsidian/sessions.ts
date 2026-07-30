import {
  textResult,
  TOOL_PIVI_SESSIONS,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

import type { ObsidianToolDeps } from './deps';

export function createSessionsTool(deps: ObsidianToolDeps): ToolSpec {
  const recovery = deps.sessionRecovery;
  if (!recovery) throw new Error('Session recovery dependency is required.');
  return {
    name: TOOL_PIVI_SESSIONS,
    label: 'Pivi Sessions',
    description: 'List recoverable deleted Pivi sessions or restore one and open it in a visible Pivi tab.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list_deleted', 'restore'] },
        sessionFile: { type: 'string', description: 'Required for restore.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const input = params as Record<string, unknown>;
      if (input.action === 'list_deleted') {
        const sessions = await recovery.listDeleted();
        return textResult(JSON.stringify({ sessions }, null, 2), { action: 'list_deleted' });
      }
      if (input.action !== 'restore') {
        throw new Error('Invalid sessions action: must be list_deleted or restore.');
      }
      if (typeof input.sessionFile !== 'string' || input.sessionFile.trim().length === 0) {
        throw new Error('sessionFile is required for restore action.');
      }
      const restored = await recovery.restore(input.sessionFile);
      return textResult(JSON.stringify(restored, null, 2), { action: 'restore' });
    },
  };
}
