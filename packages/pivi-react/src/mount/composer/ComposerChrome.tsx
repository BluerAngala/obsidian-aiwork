import { useEffect, useRef } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon, QueueMessageIcon } from '../../icons';
import { usePresentationPlatform } from '../../platform';
import type { ChatUiSnapshot } from '../../store';
import type { ComposerChromeActions } from '../activeChatUiBridge';
import {
  ModelSelector,
  ModeSelector,
  ThinkingSelector,
} from './ComposerSelectors';
import { UsageMeter } from './UsageMeter';

export function ComposerChrome({
  snapshot,
  actions,
}: {
  snapshot: ChatUiSnapshot;
  actions: ComposerChromeActions | null;
}) {
  const t = useT();
  const platform = usePresentationPlatform();
  const sendWrapRef = useRef<HTMLDivElement>(null);
  const { composer } = snapshot;
  const queuesMessage = snapshot.isStreaming && composer.canSend;
  const stopsResponse = snapshot.isStreaming && !composer.canSend;
  const sendDisabled = !snapshot.isStreaming && !composer.canSend;
  const sendTooltip = queuesMessage
    ? t('chat.composer.queueTitle')
    : stopsResponse
      ? t('chat.composer.stopTitle')
      : composer.canSend
        ? t('chat.composer.sendTitle')
        : t('chat.composer.sendEmptyTitle');
  useEffect(() => {
    const wrap = sendWrapRef.current;
    if (!wrap || !actions) return;
    platform.attachTooltip(wrap, sendTooltip);
  }, [actions, platform, sendTooltip]);
  if (!actions) return null;
  return (
    <div className="pivi-input-toolbar">
      <ModelSelector onChange={actions.setModel} options={composer.modelOptions} value={composer.model} />
      <ThinkingSelector
        adaptive={composer.adaptiveReasoning}
        defaultValue={composer.defaultReasoningValue}
        onChange={composer.adaptiveReasoning ? actions.setThinkingLevel : actions.setThinkingBudget}
        options={composer.thinkingOptions}
        value={composer.adaptiveReasoning ? composer.thinkingLevel : composer.thinkingBudget}
      />
      <ModeSelector
        activeValue={composer.modeActiveValue}
        label={composer.modeLabel}
        onChange={actions.setMode}
        options={composer.modeOptions}
        value={composer.mode}
      />
      <div className="pivi-input-action-group">
        <UsageMeter usage={snapshot.usage} />
        <div className="pivi-send-button-wrap" ref={sendWrapRef}>
          <button
            aria-label={queuesMessage
              ? t('chat.composer.queueAria')
              : stopsResponse
              ? t('chat.composer.stopAria')
              : composer.canSend
                ? t('chat.composer.sendAria')
                : t('chat.composer.sendEmptyAria')}
            className={`pivi-send-button pivi-send-${queuesMessage ? 'queue' : stopsResponse ? 'streaming' : composer.canSend ? 'ready' : 'disabled'}`}
            disabled={sendDisabled}
            onClick={stopsResponse ? actions.stop : actions.send}
            type="button"
          >
            {queuesMessage
              ? <><QueueMessageIcon /><span className="pivi-send-button-label">{t('chat.composer.queueTitle')}</span></>
              : <><PlatformIcon name={stopsResponse ? 'square' : 'arrow-up'} /><span className="pivi-send-button-label">{stopsResponse ? t('chat.composer.stopTitle') : t('chat.composer.sendTitle')}</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}
