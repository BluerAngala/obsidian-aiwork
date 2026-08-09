import type { CustomPromptEntry, ReviewMode } from '../../foundation/settings';

/** Narrow host surface for concrete Pi runtime adapters. */
export interface PiRuntimeHost {
  getVaultPath(): string | null;
  settings: Record<string, unknown> & {
    model?: string;
    titleGenerationModel?: string;
    userName?: string;
    reviewMode?: ReviewMode;
    customPrompts?: CustomPromptEntry[];
  };
}
