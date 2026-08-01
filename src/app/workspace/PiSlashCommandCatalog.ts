import { randomUUID } from 'node:crypto';

import type { SlashCommand } from "@pivi/pivi-agent-core/foundation";
import {
  runSerializedSave,
  writeFileAtomically,
} from '@pivi/pivi-agent-core/foundation/configPublication';
import { PluginLogger } from "@pivi/pivi-agent-core/foundation/pluginLogger";
import type { FileStore } from "@pivi/pivi-agent-core/ports";
import type {
  SlashCommandCatalog,
  SlashCommandDropdownConfig,
} from "@pivi/pivi-agent-core/skills/commands/slashCommandCatalog";
import type { SlashCatalogEntry } from "@pivi/pivi-agent-core/skills/commands/slashCommandEntry";
import {
  COMPACT_COMMAND_ID,
  GENERATE_IMAGE_TOOL_ID,
  NEW_SESSION_COMMAND_ID,
} from "@pivi/pivi-agent-core/skills/commands/slashCommandIds";
import {
  parseSlashCommandContent,
  serializeSlashCommandMarkdown,
} from "@pivi/pivi-agent-core/skills/slashCommand";
import { TOOL_OBSIDIAN_GENERATE_IMAGE } from "@pivi/pivi-agent-core/tools/obsidianToolNames";
import type {
  AgentCommandDetail,
  AgentCommandSummary,
  PiviCommandsGetResult,
  PiviCommandsInput,
  PiviCommandsListResult,
  PiviManagementMutationResult,
} from '@pivi/pivi-agent-core/tools/piviManagement';
import { PiviManagementError } from '@pivi/pivi-agent-core/tools/piviManagement';
import type { TAbstractFile } from "obsidian";

import { t } from '@/app/i18n';

import {
  recoverCommandRemovalTransactions,
  removeCommandFiles,
} from "./commandRemovalTransaction";
import type { PiviWorkspaceHost } from "./serviceContracts";

const COMMANDS_DIR = ".pivi/commands";
const LEGACY_TEMPLATES_DIR = ".pivi/templates";
const logger = new PluginLogger('PiSlashCommandCatalog');
const COMMANDS_MUTATION_KEY = '.pivi/commands/*';

export class PiviCommandsManagementError extends Error {
  constructor(public readonly code: 'not_found' | 'not_eligible' | 'state_changed' | 'invalid_input', message: string) {
    super(message);
    this.name = 'PiviCommandsManagementError';
  }
}

export interface PiSlashCommandCatalogOptions {
  isImageGenerationEnabled?: () => boolean;
  createIntegrationKey?: () => string;
  onWorkspaceEntriesChanged?: (entries: readonly SlashCatalogEntry[]) => void;
}

export interface WorkspaceCommandCatalogSnapshot {
  readonly entries: readonly SlashCatalogEntry[];
  readonly catalogRevision: number;
}

export class PiSlashCommandCatalog implements SlashCommandCatalog {
  private workspaceEntries: SlashCatalogEntry[] = [];
  private runtimeCommands: SlashCatalogEntry[] = [];
  private isWatching = false;
  private loaded = false;
  private catalogRevision = 0;
  private readonly generatedIntegrationKeys = new Map<string, string>();

  constructor(
    private readonly plugin: PiviWorkspaceHost,
    private readonly adapter: FileStore,
    private readonly options: PiSlashCommandCatalogOptions = {},
  ) {
    this.registerVaultWatcher();
  }

  private registerVaultWatcher(): void {
    if (this.isWatching) return;
    this.isWatching = true;

    this.plugin.registerEvent(
      this.plugin.app.vault.on("create", (file: TAbstractFile) => {
        if (isCatalogCommandPath(file.path)) {
          void this.refresh().catch(error => logger.error('Failed to refresh command watcher event', error));
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file: TAbstractFile) => {
        if (isCatalogCommandPath(file.path)) {
          void this.refresh().catch(error => logger.error('Failed to refresh command watcher event', error));
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on("delete", (file: TAbstractFile) => {
        if (isCatalogCommandPath(file.path)) {
          void this.refresh().catch(error => logger.error('Failed to refresh command watcher event', error));
        }
      }),
    );

    this.plugin.registerEvent(
      this.plugin.app.vault.on(
        "rename",
        (file: TAbstractFile, oldPath: string) => {
          if (isCatalogCommandPath(file.path) || isCatalogCommandPath(oldPath)) {
            void this.refresh().catch(error => logger.error('Failed to refresh command watcher event', error));
          }
        },
      ),
    );
  }

  async listDropdownEntries(context: {
    includeBuiltIns: boolean;
  }): Promise<SlashCatalogEntry[]> {
    if (!this.loaded) {
      await this.refresh();
    }
    const combined = [...this.workspaceEntries];

    if (this.options.isImageGenerationEnabled?.()) {
      combined.push({
        id: GENERATE_IMAGE_TOOL_ID,
        kind: "tool",
        name: GENERATE_IMAGE_TOOL_ID,
        description: "Generate an image with the enabled image tool",
        content: "",
        toolName: TOOL_OBSIDIAN_GENERATE_IMAGE,
        scope: "builtin",
        source: "builtin",
        isEditable: false,
        isDeletable: false,
        displayPrefix: "/",
        insertPrefix: "/",
      });
    }

    combined.push({
      id: COMPACT_COMMAND_ID,
      kind: "command",
      name: COMPACT_COMMAND_ID,
      description: "Compact this session to preserve context",
      content: "/compact",
      scope: "builtin",
      source: "builtin",
      isEditable: false,
      isDeletable: false,
      displayPrefix: "/",
      insertPrefix: "/",
    });

    combined.push({
      id: NEW_SESSION_COMMAND_ID,
      kind: "command",
      name: NEW_SESSION_COMMAND_ID,
      description: t('chat.slash.newSessionDescription'),
      content: "",
      scope: "builtin",
      source: "builtin",
      isEditable: false,
      isDeletable: false,
      displayPrefix: "/",
      insertPrefix: "/",
    });

    if (context.includeBuiltIns) {
      combined.push(...this.runtimeCommands);
    }
    return combined;
  }

  async listWorkspaceEntries(): Promise<SlashCatalogEntry[]> {
    if (!this.loaded) {
      await this.refresh();
    }
    return this.workspaceEntries.map(entry => ({ ...entry }));
  }

  async getWorkspaceSnapshot(): Promise<WorkspaceCommandCatalogSnapshot> {
    await this.refresh();
    return {
      entries: this.workspaceEntries.map(entry => ({ ...entry })),
      catalogRevision: this.catalogRevision,
    };
  }

  async saveWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<void> {
    await runSerializedSave(COMMANDS_MUTATION_KEY, async () => {
      await this.refreshUnlocked();
      this.requireRevision(catalogRevision);
      const existing = this.workspaceEntries.find(candidate => candidate.id === entry.id);
      const path = `${COMMANDS_DIR}/${entry.id}.md`;
      const command: SlashCommand = {
        ...entry,
        kind: 'command',
        argumentHint: entry.argumentHint?.trim() || entry.name,
        integrationKey: existing?.integrationKey ?? entry.integrationKey ?? this.createIntegrationKey(),
      };
      await this.assertRevision(catalogRevision);
      await writeFileAtomically(
        this.adapter,
        path,
        serializeSlashCommandMarkdown(command, entry.content),
      );
      if (existing?.persistenceKey?.startsWith("legacy-template:")) {
        const legacyPath = `${LEGACY_TEMPLATES_DIR}/${entry.id}.md`;
        if (await this.adapter.exists(legacyPath)) await this.adapter.delete(legacyPath);
      }
      await this.refreshUnlocked();
    });
  }

  async renameWorkspaceEntry(previous: SlashCatalogEntry, entry: SlashCatalogEntry, catalogRevision: number): Promise<void> {
    await runSerializedSave(COMMANDS_MUTATION_KEY, async () => {
      await this.refreshUnlocked();
      this.requireRevision(catalogRevision);
      const existing = this.workspaceEntries.find(candidate => candidate.id === previous.id);
      if (!existing || existing.scope !== 'workspace' || !existing.isEditable || !existing.isDeletable) {
        throw new PiviCommandsManagementError('not_eligible', `Command /${previous.id} is not an editable workspace command.`);
      }
      if (this.workspaceEntries.some(candidate => candidate.id === entry.id && candidate.id !== previous.id)) {
        throw new PiviCommandsManagementError('state_changed', `Command /${entry.id} already exists.`);
      }
      await this.assertRevision(catalogRevision);
      const oldPath = existing.persistenceKey?.startsWith('legacy-template:')
        ? `${LEGACY_TEMPLATES_DIR}/${previous.id}.md`
        : `${COMMANDS_DIR}/${previous.id}.md`;
      const newPath = `${COMMANDS_DIR}/${entry.id}.md`;
      const backupPath = `${oldPath}.rename-${Date.now().toString(36)}`;
      const command: SlashCommand = { ...entry, kind: 'command',
        argumentHint: entry.argumentHint?.trim() || entry.name,
        integrationKey: existing.integrationKey ?? this.createIntegrationKey() };
      await this.adapter.rename(oldPath, backupPath);
      try {
        await writeFileAtomically(this.adapter, newPath, serializeSlashCommandMarkdown(command, entry.content));
        await this.adapter.delete(backupPath);
      } catch (error) {
        if (await this.adapter.exists(newPath)) await this.adapter.delete(newPath).catch(() => undefined);
        await this.adapter.rename(backupPath, oldPath).catch(() => undefined);
        throw error;
      }
      await this.refreshUnlocked();
    });
  }

  async deleteWorkspaceEntry(entry: SlashCatalogEntry, catalogRevision: number): Promise<{
    saved: true;
    refreshed: boolean;
    warnings?: string[];
  }> {
    return runSerializedSave(COMMANDS_MUTATION_KEY, async () => {
      await this.refreshUnlocked();
      this.requireRevision(catalogRevision);
      const exact = this.workspaceEntries.find(candidate => candidate.id === entry.id);
      if (!exact || exact.scope !== 'workspace' || !exact.isEditable || !exact.isDeletable) {
        throw new PiviCommandsManagementError('not_eligible', `Command /${entry.id} is not an editable workspace command.`);
      }
      await this.assertRevision(catalogRevision);
      const cleanupFailed = await removeCommandFiles(this.adapter, entry.id);
      await this.refreshUnlocked();
      return cleanupFailed
        ? { saved: true, refreshed: false,
            warnings: ['Command was removed, but transaction cleanup failed.'] }
        : { saved: true, refreshed: true };
    });
  }

  async saveWorkspaceOrder(ids: readonly string[], catalogRevision: number): Promise<void> {
    await runSerializedSave(COMMANDS_MUTATION_KEY, async () => {
      await this.refreshUnlocked();
      this.requireRevision(catalogRevision);
      const eligible = new Set(this.workspaceEntries.map(entry => entry.id));
      if (ids.length !== eligible.size || new Set(ids).size !== ids.length || ids.some(id => !eligible.has(id))) {
        throw new PiviCommandsManagementError('state_changed', 'Command order no longer matches the current catalog.');
      }
      await this.assertRevision(catalogRevision);
      const previousOrder = this.plugin.settings.workspaceCommandOrder;
      this.plugin.settings.workspaceCommandOrder = [...ids];
      try {
        await this.plugin.saveSettings();
      } catch (error) {
        this.plugin.settings.workspaceCommandOrder = previousOrder;
        throw error;
      }
      await this.refreshUnlocked();
    });
  }

  async executeCommands(input: PiviCommandsInput, signal?: AbortSignal): Promise<unknown> {
    if (input.action === 'list') return this.agentList();
    if (input.action === 'get') return this.agentGet(input.id);
    if (input.action === 'upsert') {
      if (input.name !== undefined && input.name !== input.id) {
        throw new PiviCommandsManagementError('invalid_input', 'Command rename is not supported; name must equal id.');
      }
      return runSerializedSave(COMMANDS_MUTATION_KEY, async () => {
        throwIfCommandsAborted(signal);
        await this.refreshUnlocked();
        this.requireRevision(input.catalogRevision);
        const conflicting = this.runtimeCommands.find(item => item.id === input.id);
        if (conflicting || input.id === COMPACT_COMMAND_ID || input.id === GENERATE_IMAGE_TOOL_ID) {
          throw new PiviCommandsManagementError('not_eligible',
            `Command /${input.id} is owned by ${conflicting?.scope ?? 'builtin'}.`);
        }
        const existing = this.workspaceEntries.find(item => item.id === input.id);
        const command: SlashCommand = { id: input.id, kind: 'command', name: input.id,
          description: input.description, argumentHint: input.argumentHint?.trim() || input.id,
          icon: input.icon, content: input.content,
          integrationKey: existing?.integrationKey ?? this.createIntegrationKey() };
        await this.assertRevision(input.catalogRevision);
        throwIfCommandsAborted(signal);
        await writeFileAtomically(this.adapter, `${COMMANDS_DIR}/${input.id}.md`,
          serializeSlashCommandMarkdown(command, input.content));
        return this.refreshMutationResult(input.id);
      });
    }
    if (input.action === 'remove') {
      return runSerializedSave(COMMANDS_MUTATION_KEY, async () => {
        throwIfCommandsAborted(signal);
        await this.refreshUnlocked();
        this.requireRevision(input.catalogRevision);
        const entry = this.workspaceEntries.find(item => item.id === input.id);
        if (!entry) throw new PiviCommandsManagementError('not_found', `Command /${input.id} was not found.`);
        await this.assertRevision(input.catalogRevision);
        throwIfCommandsAborted(signal);
        const cleanupFailed = await removeCommandFiles(this.adapter, input.id);
        const result = await this.refreshMutationResult();
        if (!cleanupFailed) return result;
        return {
          ...result,
          refreshed: false,
          warnings: ['Command was removed, but transaction cleanup failed.'],
          refreshFailures: [
            ...(result.refreshFailures ?? []),
            { target: 'commands:cleanup', message: 'Transaction cleanup failed.' },
          ],
        };
      });
    }
    return runSerializedSave(COMMANDS_MUTATION_KEY, async () => {
      throwIfCommandsAborted(signal);
      await this.refreshUnlocked();
      this.requireRevision(input.catalogRevision);
      const ids = this.workspaceEntries.map(entry => entry.id);
      const from = ids.indexOf(input.id);
      const anchorId = input.beforeId ?? input.afterId!;
      const anchor = ids.indexOf(anchorId);
      if (from < 0 || anchor < 0 || input.id === anchorId) {
        throw new PiviCommandsManagementError('not_eligible', 'Move requires two distinct editable workspace commands.');
      }
      ids.splice(from, 1);
      const currentAnchor = ids.indexOf(anchorId);
      ids.splice(input.beforeId ? currentAnchor : currentAnchor + 1, 0, input.id);
      await this.assertRevision(input.catalogRevision);
      throwIfCommandsAborted(signal);
      const previousOrder = this.plugin.settings.workspaceCommandOrder;
      this.plugin.settings.workspaceCommandOrder = ids;
      try {
        await this.plugin.saveSettings();
      } catch (error) {
        this.plugin.settings.workspaceCommandOrder = previousOrder;
        throw error;
      }
      const refreshResult = await this.refreshMutationResult(input.id);
      if (!refreshResult.refreshed) return refreshResult;
      const effective = this.workspaceEntries.find(entry => entry.id === input.id);
      if (!effective) throw new PiviCommandsManagementError('not_found', `Command /${input.id} was not found.`);
      return {
        saved: true,
        refreshed: true,
        effective: { ...toAgentSummary(effective), content: effective.content },
      } satisfies PiviManagementMutationResult<AgentCommandDetail>;
    });
  }

  setRuntimeCommands(commands: SlashCommand[]): void {
    this.runtimeCommands = commands.map((cmd) => ({
      id: cmd.id,
      kind: cmd.kind ?? "command",
      name: cmd.name,
      description: cmd.description,
      content: cmd.content,
      argumentHint: cmd.argumentHint,
      icon: cmd.icon,
      integrationKey: cmd.integrationKey,
      allowedTools: cmd.allowedTools,
      model: cmd.model,
      disableModelInvocation: cmd.disableModelInvocation,
      userInvocable: cmd.userInvocable,
      context: cmd.context,
      agent: cmd.agent,
      hooks: cmd.hooks,
      scope: "runtime",
      source: cmd.source ?? "sdk",
      isEditable: false,
      isDeletable: false,
      displayPrefix: "/",
      insertPrefix: "/",
    }));
  }

  getDropdownConfig(): SlashCommandDropdownConfig {
    return {
      triggerChars: ["/"],
      builtInPrefix: "/",
      skillPrefix: "/",
      commandPrefix: "/",
    };
  }

  async refresh(): Promise<void> {
    await runSerializedSave(COMMANDS_MUTATION_KEY, () => this.refreshUnlocked());
  }

  async prepareWorkspace(): Promise<void> {
    await runSerializedSave(COMMANDS_MUTATION_KEY, async () => {
      await this.adapter.ensureFolder(COMMANDS_DIR);
      await recoverCommandRemovalTransactions(this.adapter);
      const files = (await Promise.all([COMMANDS_DIR, LEGACY_TEMPLATES_DIR]
        .map(dir => this.adapter.listFiles(dir)))).flat().filter(path => isCatalogCommandPath(path));
      for (const file of files) {
        const content = await this.adapter.read(file);
        const parsed = parseSlashCommandContent(content);
        if (typeof parsed.integrationKey === 'string'
          && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(parsed.integrationKey)) continue;
        const filename = file.split('/').at(-1);
        if (!filename) throw new Error(`Custom command has no filename: ${file}`);
        const id = filename.slice(0, -3);
        const integrationKey = this.createIntegrationKey();
        await writeFileAtomically(this.adapter, file, serializeSlashCommandMarkdown({
          id, name: id, description: parsed.description, argumentHint: parsed.argumentHint || id,
          icon: parsed.icon, integrationKey, content: parsed.promptContent,
        }, parsed.promptContent));
      }
      await this.refreshUnlocked();
    });
  }

  private async refreshUnlocked(): Promise<void> {
      await recoverCommandRemovalTransactions(this.adapter);
      const byId = new Map<string, SlashCatalogEntry>();
      const authoritativeBytes: Array<[string, string, string]> = [];

      for (const dir of [LEGACY_TEMPLATES_DIR, COMMANDS_DIR]) {
        const files = await this.adapter.listFiles(dir);
        const mdFiles = files.filter((f) => isCatalogCommandPath(f));

        for (const file of mdFiles) {
          try {
            const content = await this.adapter.read(file);
            const parsed = parseSlashCommandContent(content);
            authoritativeBytes.push([dir, file, content]);

            const parts = file.split("/");
            const filename = parts.at(-1);
            if (!filename) {
              logger.error(`Custom command has no filename: ${file}`);
              continue;
            }
            const id = filename.substring(0, filename.lastIndexOf(".md"));
            const integrationKey = typeof parsed.integrationKey === 'string'
              && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(parsed.integrationKey)
              ? parsed.integrationKey
              : this.generatedIntegrationKeys.get(id) ?? this.createIntegrationKey();
            this.generatedIntegrationKeys.set(id, integrationKey);

            byId.set(id, {
              id,
              kind: "command",
              name: id,
              description:
                parsed.description ?? `Custom command from ${filename}`,
              content: parsed.promptContent,
              argumentHint: parsed.argumentHint || id,
              icon: parsed.icon,
              integrationKey,
              scope: "workspace",
              source: "user",
              isEditable: true,
              isDeletable: true,
              displayPrefix: "/",
              insertPrefix: "/",
              persistenceKey:
                dir === LEGACY_TEMPLATES_DIR
                  ? `legacy-template:${id}`
                  : `vault:${id}`,
            });
          } catch (e) {
            logger.error(`Failed to parse custom command ${file}`, e);
            throw e;
          }
        }
      }
      const order = this.plugin.settings.workspaceCommandOrder ?? [];
      const rank = new Map(order.map((id, index) => [id, index]));
      const entries = [...byId.values()].sort((a, b) => {
        const rankA = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rankB = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return rankA - rankB;
      });
      const fingerprint = JSON.stringify({
        files: authoritativeBytes,
        identities: entries.map(entry => [entry.id, entry.integrationKey]),
        order,
      });
      const nextRevision = hashRevision(fingerprint);
      const changed = !this.loaded || nextRevision !== this.catalogRevision;
      this.workspaceEntries = entries;
      this.catalogRevision = nextRevision;
      this.loaded = true;
      if (changed) this.options.onWorkspaceEntriesChanged?.(entries.map(entry => ({ ...entry })));
  }

  private async agentList(): Promise<PiviCommandsListResult> {
    await this.refresh();
    return { commands: this.workspaceEntries.map(toAgentSummary), catalogRevision: this.catalogRevision };
  }

  private async agentGet(id: string): Promise<PiviCommandsGetResult> {
    await this.refresh();
    const entry = this.workspaceEntries.find(candidate => candidate.id === id);
    if (!entry) throw new PiviCommandsManagementError('not_found', `Command /${id} was not found.`);
    return { command: { ...toAgentSummary(entry), content: entry.content }, catalogRevision: this.catalogRevision };
  }

  private mutationResultUnlocked(id: string): PiviManagementMutationResult<AgentCommandDetail> {
    const entry = this.workspaceEntries.find(candidate => candidate.id === id);
    if (!entry) throw new PiviCommandsManagementError('not_found', `Command /${id} was not found.`);
    return { saved: true, refreshed: true, effective: { ...toAgentSummary(entry), content: entry.content } };
  }

  private async refreshMutationResult(id?: string): Promise<PiviManagementMutationResult<AgentCommandDetail>> {
    try {
      await this.refreshUnlocked();
      return id ? this.mutationResultUnlocked(id) : { saved: true, refreshed: true };
    } catch {
      return {
        saved: true,
        refreshed: false,
        refreshFailures: [{ target: 'commands:catalog', message: 'Runtime refresh failed.' }],
      };
    }
  }

  private requireRevision(expectedRevision: number): void {
    if (expectedRevision !== this.catalogRevision) {
      throw new PiviCommandsManagementError('state_changed', 'Command catalog changed; list commands and retry.');
    }
  }

  private async assertRevision(expectedRevision: number): Promise<void> {
    await this.refreshUnlocked();
    this.requireRevision(expectedRevision);
  }

  private createIntegrationKey(): string {
    return this.options.createIntegrationKey?.() ?? randomUUID();
  }
}

function throwIfCommandsAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new PiviManagementError('cancelled', 'Command management was cancelled.');
  }
}

function toAgentSummary(entry: SlashCatalogEntry): AgentCommandSummary {
  return { id: entry.id, name: entry.name, description: entry.description,
    argumentHint: entry.argumentHint, icon: entry.icon, scope: entry.scope,
    source: entry.source, isEditable: entry.isEditable, isDeletable: entry.isDeletable };
}

function hashRevision(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Catalog command markdown only — never removal artifacts or non-md siblings. */
function isCatalogCommandPath(path: string): boolean {
  if (!path.endsWith('.md')) return false;
  const slash = path.lastIndexOf('/');
  const filename = slash >= 0 ? path.slice(slash + 1) : path;
  if (filename.includes('.')) {
    // Require exactly one trailing `.md` extension (no `.md.remove-*`, `.tmp`, …).
    if (filename.slice(0, -3).includes('.')) return false;
  }
  return path.startsWith(`${COMMANDS_DIR}/`) || path.startsWith(`${LEGACY_TEMPLATES_DIR}/`);
}
