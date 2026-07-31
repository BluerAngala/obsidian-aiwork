import { type App, Modal, Setting } from 'obsidian';

import { t } from '@/app/i18n';

export function requestOAuthManualCode(
  app: App,
  message: string,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    new OAuthManualCodeModal(app, message, signal, resolve).open();
  });
}

class OAuthManualCodeModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly message: string,
    private readonly signal: AbortSignal,
    private readonly resolve: (value: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    if (this.signal.aborted) {
      this.close();
      return;
    }
    this.signal.addEventListener('abort', this.handleAbort, { once: true });
    this.setTitle(t('common.confirm'));
    this.contentEl.createEl('p', { text: this.message });

    let submit = (): void => undefined;
    new Setting(this.contentEl)
      .addText(input => {
        submit = () => {
          const value = input.getValue().trim();
          if (value) {
            this.finish(value);
          }
        };
        input.inputEl.addEventListener('keydown', event => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            submit();
          }
        });
        input.inputEl.focus();
      })
      .addButton(button => button
        .setButtonText(t('common.cancel'))
        .onClick(() => this.close()))
      .addButton(button => button
        .setButtonText(t('common.confirm'))
        .setCta()
        .onClick(() => submit()));
  }

  onClose(): void {
    this.signal.removeEventListener('abort', this.handleAbort);
    if (!this.resolved) {
      this.resolved = true;
      this.resolve(null);
    }
    this.contentEl.empty();
  }

  private readonly handleAbort = (): void => {
    this.close();
  };

  private finish(value: string): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolve(value);
    this.close();
  }
}
