import type { SessionMentionItem } from './types';

export interface SessionMentionProvider {
  listSessions(): Array<{ id: string; title: string; preview: string; sessionFile?: string }>;
}

export function findSessionMentionQuery(textBeforeCursor: string): {
  query: string;
  startIndex: number;
} | null {
  const match = textBeforeCursor.match(/(?:^|\s)@@([^\s]*)$/);
  if (!match) return null;
  const query = match[1] ?? '';
  return { query, startIndex: textBeforeCursor.length - query.length - 2 };
}

export function buildSessionMentionItems(
  provider: SessionMentionProvider | null,
  searchLower: string,
): SessionMentionItem[] {
  return (provider?.listSessions() ?? []).flatMap((session) => {
    if (!session.sessionFile) return [];
    if (!session.title.toLowerCase().includes(searchLower)
      && !session.preview.toLowerCase().includes(searchLower)) return [];
    return [{
      type: 'session' as const,
      id: session.id,
      name: session.title,
      preview: session.preview,
      sessionFile: session.sessionFile,
    }];
  });
}
