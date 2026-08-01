import type { SessionRecoveryPort } from '@pivi/pivi-agent-core/session';
import {
  createSessionsTool,
  TOOL_PIVI_SESSIONS,
  type ToolSpec,
} from '@pivi/pivi-agent-core/tools';

/** Compose host-neutral session tooling into the shared/base Agent inventory. */
export function createBaseSessionTools(
  recovery: SessionRecoveryPort,
  disabledTools: readonly string[] = [],
): ToolSpec[] {
  return disabledTools.includes(TOOL_PIVI_SESSIONS)
    ? []
    : [createSessionsTool(recovery)];
}
