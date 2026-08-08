import { useCallback, useRef, useState } from 'react';

import { useT } from '../../i18n';
import { PlatformIcon } from '../../icons';
import type { ChatProjectionStore } from '../../store';
import type { ChatSurfaceActions } from '../types';

interface UserMessage {
  id: string;
  content: string;
  timestamp: number;
}

export function NavigationSurface({ visible, actions, projectionStore, scrollToMessage }: {
  visible: boolean;
  actions: ChatSurfaceActions;
  projectionStore?: ChatProjectionStore | null;
  scrollToMessage?: (messageId: string) => void;
}) {
  const t = useT();
  const [showMessageList, setShowMessageList] = useState(false);
  const [userMessages, setUserMessages] = useState<UserMessage[]>([]);
  const hoverTimeoutRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadUserMessages = useCallback(() => {
    if (!projectionStore) return;
    const order = projectionStore.getOrderSnapshot();
    const messages: UserMessage[] = [];
    for (const id of order) {
      const msg = projectionStore.getMessageSnapshot(id) as { role?: string; content?: string; displayContent?: string; timestamp?: number } | null;
      if (msg?.role === 'user') {
        messages.push({
          id,
          content: msg.displayContent ?? msg.content ?? '',
          timestamp: msg.timestamp ?? 0,
        });
      }
    }
    setUserMessages(messages);
  }, [projectionStore]);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      loadUserMessages();
      setShowMessageList(true);
    }, 300);
  }, [loadUserMessages]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setShowMessageList(false);
    }, 200);
  }, []);

  const handleMessageClick = useCallback((messageId: string) => {
    scrollToMessage?.(messageId);
    setShowMessageList(false);
  }, [scrollToMessage]);

  return (
    <div 
      className={`pivi-nav-sidebar${visible ? ' visible' : ''}`}
      ref={containerRef}
    >
      <button aria-label={t('chat.nav.scrollToTop')} className="pivi-nav-btn pivi-nav-btn-top" onClick={actions.scrollToTop} type="button"><PlatformIcon name="chevrons-up" /></button>
      <button aria-label={t('chat.nav.previousMessage')} className="pivi-nav-btn pivi-nav-btn-prev" onClick={actions.scrollToPreviousUserMessage} type="button"><PlatformIcon name="chevron-up" /></button>
      
      <div 
        className="pivi-nav-message-list-container"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <button 
          aria-label={t('chat.nav.messageList')} 
          className="pivi-nav-btn pivi-nav-btn-list" 
          onClick={() => {
            loadUserMessages();
            setShowMessageList(!showMessageList);
          }} 
          type="button"
        >
          <PlatformIcon name="list" />
        </button>
        
        {showMessageList && userMessages.length > 0 && (
          <div className="pivi-nav-message-list">
            <div className="pivi-nav-message-list-header">
              {t('chat.nav.messageListTitle')}
            </div>
            <div className="pivi-nav-message-list-items">
              {userMessages.map((msg) => (
                <button
                  key={msg.id}
                  className="pivi-nav-message-item"
                  onClick={() => handleMessageClick(msg.id)}
                  title={msg.content}
                  type="button"
                >
                  <span className="pivi-nav-message-item-text">
                    {msg.content.length > 50 ? `${msg.content.substring(0, 50)}...` : msg.content}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      
      <button aria-label={t('chat.nav.nextMessage')} className="pivi-nav-btn pivi-nav-btn-next" onClick={actions.scrollToNextUserMessage} type="button"><PlatformIcon name="chevron-down" /></button>
      <button aria-label={t('chat.nav.scrollToBottom')} className="pivi-nav-btn pivi-nav-btn-bottom" onClick={actions.scrollToBottom} type="button"><PlatformIcon name="chevrons-down" /></button>
    </div>
  );
}
