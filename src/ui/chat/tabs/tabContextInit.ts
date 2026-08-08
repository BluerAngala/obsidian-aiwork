import type { ChatPorts } from '@pivi/pivi-agent-core/runtime/chatPorts';
import type { App, TAbstractFile } from 'obsidian';
import { Notice, TFile, TFolder } from 'obsidian';

import type { PiviChatHost } from "@/app/hostContracts";

import { FileContextManager } from "../ui/FileContext";
import { ImageContextManager } from "../ui/ImageContext";
import { autoResizeTextarea } from "../ui/textareaResize";
import { createFileContextMcpProvider } from "./tabCatalogAdapters";
import type { TabData } from "./types";

export function initializeContextManagers(
  tab: TabData,
  plugin: PiviChatHost,
  ports: ChatPorts,
): void {
  const { dom } = tab;
  const app = plugin.app;

  tab.ui.fileContextManager = new FileContextManager(
    app,
    dom.contextRowEl,
    dom.richInput,
    {
      getExcludedTags: () => ports.settings.getSettingsSnapshot().excludedTags,
      onChipsChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.richInput.el);
      },
      getExternalContexts: () =>
        tab.ui.externalContextSelector?.getExternalContexts() || [],
      getSkillNames: () =>
        new Set(ports.catalog.listSkills().map((skill) => skill.name)),
      getSessions: () => ports.sessions.listSessions(),
    },
    dom.inputContainerEl,
  );
  tab.ui.fileContextManager.setMcpManager(createFileContextMcpProvider(ports.catalog));
  dom.richInput.setMentionContextGetter(() =>
    tab.ui.fileContextManager!.buildMentionBadgeContext(),
  );

  tab.ui.imageContextManager = new ImageContextManager(
    dom.inputContainerEl,
    dom.richInput,
    {
      onImagesChanged: () => {
        tab.controllers.selectionController?.updateContextRowVisibility();
        tab.controllers.browserSelectionController?.updateContextRowVisibility();
        tab.controllers.canvasSelectionController?.updateContextRowVisibility();
        autoResizeTextarea(dom.richInput.el);
        tab.ui.composerActions?.refresh();
      },
    },
    dom.contextRowEl,
  );

  setupFileFolderDrop(tab, app);
}

function setupFileFolderDrop(tab: TabData, app: App): void {
  const { dom } = tab;
  const inputWrapper = dom.inputWrapper;

  const handleDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer) return;
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = (e: DragEvent): void => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    e.stopPropagation();

    const raw = e.dataTransfer.getData('text/plain')?.trim();
    if (!raw) return;

    const before = tab.dom.richInput.value;

    // 解析 obsidian:// URI（文件拖拽格式：obsidian://open?vault=XXX&file=path）
    let filePath = raw;
    if (raw.startsWith('obsidian://')) {
      try {
        const url = new URL(raw);
        const fileParam = url.searchParams.get('file');
        if (fileParam) filePath = decodeURIComponent(fileParam);
      } catch { /* not a valid URI, use raw */ }
    }

    // 直接路径匹配
    const direct = app.vault.getAbstractFileByPath(filePath);
    if (direct instanceof TFolder) {
      // 检查父目录下是否有同名 .md（Obsidian 文件夹笔记模式）
      const parentPath = filePath.split('/').slice(0, -1).join('/');
      const folderName = filePath.split('/').pop()!;
      const sameNameFile = app.vault.getAbstractFileByPath(
        parentPath ? `${parentPath}/${folderName}.md` : `${folderName}.md`,
      );
      if (sameNameFile instanceof TFile) {
        tab.dom.richInput.insertFileMention(sameNameFile.path);
      } else {
        tab.dom.richInput.insertFolderMention(direct.path);
      }
      return;
    }
    if (direct instanceof TFile) {
      tab.dom.richInput.insertFileMention(direct.path);
      return;
    }

    // 文件可能缺少 .md 后缀
    if (!filePath.endsWith('.md')) {
      const withExt = app.vault.getAbstractFileByPath(`${filePath}.md`);
      if (withExt instanceof TFile) {
        tab.dom.richInput.insertFileMention(withExt.path);
        return;
      }
    }

    // 按文件名搜索整个 vault（text/plain 可能只有文件名没有路径）
    const name = filePath.split('/').pop() ?? filePath;
    const fileMatch = app.vault.getFiles().find((f) => f.name === name || f.name === `${name}.md`);
    if (fileMatch) {
      tab.dom.richInput.insertFileMention(fileMatch.path);
      return;
    }

    // 搜索文件夹
    const findFolder = (children: TAbstractFile[]): TFolder | null => {
      for (const child of children) {
        if (child instanceof TFolder) {
          if (child.name === name) return child;
          const found = findFolder(child.children);
          if (found) return found;
        }
      }
      return null;
    };
    const folderMatch = findFolder(app.vault.getRoot().children);
    if (folderMatch) {
      // 检查文件夹笔记模式
      const parentPath2 = folderMatch.parent?.path ?? '';
      const sameNameFile2 = app.vault.getAbstractFileByPath(
        parentPath2 ? `${parentPath2}/${folderMatch.name}.md` : `${folderMatch.name}.md`,
      );
      if (sameNameFile2 instanceof TFile) {
        tab.dom.richInput.insertFileMention(sameNameFile2.path);
      } else {
        tab.dom.richInput.insertFolderMention(folderMatch.path);
      }
      return;
    }

    // 所有解析都失败 — 打印调试信息
    if (tab.dom.richInput.value === before) {
      new Notice(
        `[Pivi] 拖拽解析失败\nraw: ${raw}\nfilePath: ${filePath}\ntype: ${direct?.constructor.name ?? 'null'}`,
        6000,
      );
    }
  };

  inputWrapper.addEventListener('dragover', handleDragOver);
  inputWrapper.addEventListener('drop', handleDrop);
  tab.dom.eventCleanups.push(() => {
    inputWrapper.removeEventListener('dragover', handleDragOver);
    inputWrapper.removeEventListener('drop', handleDrop);
  });
}
