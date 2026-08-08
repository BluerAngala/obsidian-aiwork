import { useEffect, useRef, useState } from 'react';

import type { ChatTabSnapshotItem } from '../../store';
import { TITLE_SCROLL_DURATION_MS } from './constants';

export function ActiveTabTitle({ item, ownerWindow, defaultTitle }: {
  item: ChatTabSnapshotItem;
  ownerWindow: Window;
  defaultTitle?: string;
}) {
  const [displayedTitle, setDisplayedTitle] = useState(item.title || defaultTitle || '');
  const [scrollClass, setScrollClass] = useState('');
  const previous = useRef({ id: item.id, index: item.index, title: item.title });

  useEffect(() => {
    const prior = previous.current;
    if (prior.id === item.id && prior.index === item.index && prior.title === item.title) return;
    const direction = prior.id === item.id || item.index >= prior.index
      ? 'is-scrolling-up'
      : 'is-scrolling-down';
    previous.current = { id: item.id, index: item.index, title: item.title };
    setScrollClass(direction);
    const timer = ownerWindow.setTimeout(() => {
      setDisplayedTitle(item.title || defaultTitle || '');
      setScrollClass('');
    }, TITLE_SCROLL_DURATION_MS);
    return () => ownerWindow.clearTimeout(timer);
  }, [item.id, item.index, item.title, ownerWindow, defaultTitle]);

  return (
    <span className={`pivi-tab-switcher-title${scrollClass ? ` ${scrollClass}` : ''}`}>
      {displayedTitle}
    </span>
  );
}
