import { createInlineContextToken, type InlineContextReference } from '@pivi/pivi-agent-core/context/inlineContext';

import { getOrderedListEnterEdit } from '@/ui/chat/composer/markdownListContinuation';
import {
  buildComposerFromText,
  extractComposerContent,
  insertPlainTextAtSelection,
} from '@/ui/shared/mention/inlineMentionBadgeDom';
import {
  MentionInput,
  type MentionInputOptions,
} from '@/ui/shared/mention/MentionInput';

export type { ComposerInput } from '@/ui/shared/mention/composerInputTypes';

export type RichChatInputOptions = MentionInputOptions;

/**
 * Chat composer contenteditable with inline mention badges.
 *
 * Extends the shared {@link MentionInput} with chat-only behavior: inline-context
 * chip insertion and ordered-Markdown-list continuation.
 */
export class RichChatInput extends MentionInput {
  constructor(parent: HTMLElement, options: RichChatInputOptions) {
    super(parent, options);
  }

  insertInlineContext(context: InlineContextReference): void {
    const token = createInlineContextToken(context);
    const { text, cursorPos } = extractComposerContent(this.el);
    const prefix = text.slice(0, cursorPos).trimEnd();
    const suffix = text.slice(cursorPos).trimStart();
    const nextText = [prefix, token, suffix]
      .filter((part) => part.length > 0)
      .join(' ');
    const nextCursor = prefix.length + (prefix ? 1 : 0) + token.length + 1;

    this.isSyncing = true;
    try {
      buildComposerFromText(this.el, nextText, this.getMentionContext(), this.app, Math.min(nextCursor, nextText.length));
      this.updateEmptyState();
    } finally {
      this.isSyncing = false;
    }
    this.dispatchInputEvent();
  }

  /** Inserts a file mention token (e.g. `@path/note.md`) at the cursor position. */
  insertFileMention(filePath: string): void {
    const token = `@${filePath}`;
    const { text, cursorPos } = extractComposerContent(this.el);
    const prefix = text.slice(0, cursorPos);
    const needsSpace = prefix.length > 0 && !prefix.endsWith(' ') && !prefix.endsWith('\n');
    this.focus();
    insertPlainTextAtSelection((needsSpace ? ' ' : '') + token + ' ');
    this.syncMentionBadgesFromContent();
    this.updateEmptyState();
    this.dispatchInputEvent();
  }

  /** Inserts a folder mention token (e.g. `@folder/`) at the cursor position. */
  insertFolderMention(folderPath: string): void {
    const token = `@${folderPath}/`;
    const { text, cursorPos } = extractComposerContent(this.el);
    const prefix = text.slice(0, cursorPos);
    const needsSpace = prefix.length > 0 && !prefix.endsWith(' ') && !prefix.endsWith('\n');
    this.focus();
    insertPlainTextAtSelection((needsSpace ? ' ' : '') + token + ' ');
    this.syncMentionBadgesFromContent();
    this.updateEmptyState();
    this.dispatchInputEvent();
  }

  /** Continue an ordered Markdown list, or remove an empty marker to exit it. */
  continueOrderedMarkdownList(): boolean {
    const { text, cursorPos } = extractComposerContent(this.el);
    const edit = getOrderedListEnterEdit(text, cursorPos);
    if (!edit) return false;

    const nextText = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
    this.isSyncing = true;
    try {
      buildComposerFromText(this.el, nextText, this.getMentionContext(), this.app, edit.cursor);
      this.updateEmptyState();
    } finally {
      this.isSyncing = false;
    }
    this.dispatchInputEvent();
    return true;
  }
}
