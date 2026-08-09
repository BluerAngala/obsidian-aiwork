import type { CustomPromptEntry, ReviewMode } from '../foundation/settings';
import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptBuildOptions,
  type SystemPromptSettings,
} from './mainAgent';

export interface PiSystemPromptToolRegistry {
  registeredToolNames: string[];
  registeredToolsSection: string;
  contextAppendices: string[];
}

export function buildPiSystemPromptSettings(
  vaultPath: string | undefined,
  userName: string | undefined,
  reviewMode?: ReviewMode,
  customPrompts?: readonly CustomPromptEntry[],
): SystemPromptSettings {
  return { vaultPath, userName, reviewMode, customPrompts };
}

function buildPiSystemPromptOptions(
  toolRegistry?: Pick<PiSystemPromptToolRegistry, 'registeredToolNames' | 'registeredToolsSection' | 'contextAppendices'>,
): SystemPromptBuildOptions {
  return {
    currentDateIso: new Date().toISOString().slice(0, 10),
    registeredToolsSection: toolRegistry?.registeredToolsSection,
    registeredToolNames: toolRegistry?.registeredToolNames,
    appendices: toolRegistry?.contextAppendices,
  };
}

export function buildPiSystemPrompt(
  vaultPath: string | undefined,
  userName: string | undefined,
  toolRegistry?: Pick<PiSystemPromptToolRegistry, 'registeredToolNames' | 'registeredToolsSection' | 'contextAppendices'>,
  reviewMode?: ReviewMode,
  customPrompts?: readonly CustomPromptEntry[],
): string {
  return buildSystemPrompt(
    buildPiSystemPromptSettings(vaultPath, userName, reviewMode, customPrompts),
    buildPiSystemPromptOptions(toolRegistry),
  );
}

export function computePiSystemPromptKey(
  vaultPath: string | undefined,
  userName: string | undefined,
  toolRegistry?: Pick<PiSystemPromptToolRegistry, 'registeredToolNames' | 'registeredToolsSection' | 'contextAppendices'>,
  reviewMode?: ReviewMode,
  customPrompts?: readonly CustomPromptEntry[],
): string {
  return computeSystemPromptKey(
    buildPiSystemPromptSettings(vaultPath, userName, reviewMode, customPrompts),
    buildPiSystemPromptOptions(toolRegistry),
  );
}
