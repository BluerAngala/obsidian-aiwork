import {
  DEFAULT_VAULT_SKILLS_REPO_URL,
  DEFAULT_VAULT_SKILLS_SLUG,
  isDefaultVaultSkillFolder,
} from '@pivi/pivi-agent-core/skills/vault/defaultVaultSkills';
import { fetchDefaultVaultSkillsRemoteSha } from '@pivi/pivi-agent-core/skills/vault/fetchDefaultVaultSkillsRemoteSha';
import { notifyVaultSkillsChanged } from '@pivi/pivi-agent-core/skills/vault/notifyVaultSkillsChanged';
import type { SkillsManagementMetadataPort } from '@pivi/pivi-agent-core/skills/vault/skillsManagementCoordinator';
import { SkillsManagementCoordinator } from '@pivi/pivi-agent-core/skills/vault/skillsManagementCoordinator';
import { VaultSkillsService } from '@pivi/pivi-agent-core/skills/vault/vaultSkillsService';
import type { SettingsComplexPorts } from '@pivi/pivi-react/ports';

import type { PiviSettingsHost } from '@/app/hostContracts';
import { getLocale, t } from '@/app/i18n';

import { obsidianPresentationPlatform } from './obsidianPresentationPlatform';

export function createSettingsSkillsPort(
  host: PiviSettingsHost,
  workspaceCoordinator?: SkillsManagementCoordinator,
): SettingsComplexPorts['skills'] {
  /**
   * Default-bundle durable bookkeeping. For install of the featured slug this runs
   * inside the filesystem publication transaction (afterPublish) so save failure
   * rolls the skill tree back. Remove records removed folders after FS delete.
   */
  const metadata: SkillsManagementMetadataPort = {
    async mutationPublished(mutation, context) {
      if (context?.defaultBundleUpdate) {
        const previousSeeded = host.settings.defaultVaultSkillsSeeded;
        const previousSha = host.settings.defaultVaultSkillsCommitSha;
        host.settings.defaultVaultSkillsSeeded = true;
        if (context.defaultBundleCommitSha) {
          host.settings.defaultVaultSkillsCommitSha = context.defaultBundleCommitSha;
        }
        try {
          await host.saveSettings();
        } catch (error) {
          host.settings.defaultVaultSkillsSeeded = previousSeeded;
          if (previousSha !== undefined) host.settings.defaultVaultSkillsCommitSha = previousSha;
          else delete host.settings.defaultVaultSkillsCommitSha;
          throw error;
        }
        return;
      }
      if (mutation.action === 'remove' && isDefaultVaultSkillFolder(mutation.name)) {
        const previous = host.settings.defaultVaultSkillsRemovedFolders;
        host.settings.defaultVaultSkillsRemovedFolders = [
          ...new Set([...(host.settings.defaultVaultSkillsRemovedFolders ?? []), mutation.name]),
        ];
        try {
          await host.saveSettings();
        } catch (error) {
          if (previous !== undefined) host.settings.defaultVaultSkillsRemovedFolders = previous;
          else delete host.settings.defaultVaultSkillsRemovedFolders;
          throw error;
        }
        return;
      }
      if (mutation.action === 'install' && mutation.source === DEFAULT_VAULT_SKILLS_SLUG) {
        const previous = {
          seeded: host.settings.defaultVaultSkillsSeeded,
          dismissed: host.settings.defaultVaultSkillsPromptDismissed,
          removed: host.settings.defaultVaultSkillsRemovedFolders,
          commitSha: host.settings.defaultVaultSkillsCommitSha,
        };
        host.settings.defaultVaultSkillsSeeded = true;
        delete host.settings.defaultVaultSkillsPromptDismissed;
        delete host.settings.defaultVaultSkillsRemovedFolders;
        if (context?.defaultBundleCommitSha) {
          host.settings.defaultVaultSkillsCommitSha = context.defaultBundleCommitSha;
        }
        try {
          await host.saveSettings();
        } catch (error) {
          host.settings.defaultVaultSkillsSeeded = previous.seeded;
          if (previous.dismissed !== undefined) {
            host.settings.defaultVaultSkillsPromptDismissed = previous.dismissed;
          } else {
            delete host.settings.defaultVaultSkillsPromptDismissed;
          }
          if (previous.removed !== undefined) {
            host.settings.defaultVaultSkillsRemovedFolders = previous.removed;
          } else {
            delete host.settings.defaultVaultSkillsRemovedFolders;
          }
          if (previous.commitSha !== undefined) {
            host.settings.defaultVaultSkillsCommitSha = previous.commitSha;
          } else {
            delete host.settings.defaultVaultSkillsCommitSha;
          }
          throw error;
        }
      }
    },
  };
  let fallbackCoordinator: SkillsManagementCoordinator | undefined;
  const getCoordinator = (): SkillsManagementCoordinator => {
    if (workspaceCoordinator) return workspaceCoordinator;
    if (fallbackCoordinator) return fallbackCoordinator;
    const vaultPath = host.getVaultPath?.() ?? '';
    fallbackCoordinator = new SkillsManagementCoordinator({
      service: new VaultSkillsService(vaultPath, { processRunner: host.processRunner }),
      vaultPath,
      metadata,
    });
    return fallbackCoordinator;
  };
  return {
    featuredBundle: {
      getDescriptor: () => {
        const terminology = obsidianPresentationPlatform.getTerminology(getLocale());
        return {
          name: t('settings.skills.defaultBundle.name', { hostName: terminology.hostName }),
          description: t('settings.skills.defaultBundle.desc', {
            workspaceName: terminology.workspaceName,
          }),
          source: DEFAULT_VAULT_SKILLS_SLUG,
          sourceUrl: DEFAULT_VAULT_SKILLS_REPO_URL,
        };
      },
      isInstalled: () => {
        const vaultPath = host.getVaultPath();
        return vaultPath
          ? getCoordinator().snapshot().skills.some(
            skill => !!skill.folderName && isDefaultVaultSkillFolder(skill.folderName),
          )
          : false;
      },
      async install() {
        const remoteSha = await fetchDefaultVaultSkillsRemoteSha(host.httpClient);
        await getCoordinator().execute(
          { action: 'install', source: DEFAULT_VAULT_SKILLS_SLUG },
          undefined,
          { defaultBundleCommitSha: remoteSha },
        );
        await notifyVaultSkillsChanged(host);
      },
      async update() {
        const removedFolders = new Set(host.settings.defaultVaultSkillsRemovedFolders ?? []);
        const remoteSha = await fetchDefaultVaultSkillsRemoteSha(host.httpClient);
        await getCoordinator().updateDefaultBundle(removedFolders, {
          defaultBundleCommitSha: remoteSha,
        });
        await notifyVaultSkillsChanged(host);
      },
    },
    list: () => {
      const vaultPath = host.getVaultPath();
      return vaultPath ? getCoordinator().snapshot().skills.map(skill => ({
        name: skill.name,
        description: skill.description ?? '',
        folderName: skill.folderName ?? skill.name,
        disabled: !skill.enabled,
      })) : [];
    },
    async listRemote(source) {
      return (await getCoordinator().listRemote(source)).skills.map(skill => ({
        name: skill.name,
        description: skill.description ?? '',
      }));
    },
    async install(source, skillNames) {
      await getCoordinator().execute({
        action: 'install',
        source,
        skillNames: skillNames ? [...skillNames] : undefined,
      });
      await notifyVaultSkillsChanged(host);
    },
    async setDisabled(folderName, disabled) {
      await getCoordinator().execute({ action: 'set_enabled', name: folderName, enabled: !disabled });
      await notifyVaultSkillsChanged(host);
    },
    async remove(folderName) {
      await getCoordinator().execute({ action: 'remove', name: folderName });
      await notifyVaultSkillsChanged(host);
    },
    async updateAll() {
      await getCoordinator().execute({ action: 'update_all' });
      await notifyVaultSkillsChanged(host);
    },
    async update(skillName, folderName) {
      await getCoordinator().execute({ action: 'update', name: folderName || skillName });
      await notifyVaultSkillsChanged(host);
    },
  };
}
