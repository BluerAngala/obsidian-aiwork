import { toQueuedChatTurn } from '@/ui/chat/composer/ComposerQueue';
import type { QueuedMessage } from '@/ui/chat/state/types';

describe('inputQueue', () => {
  it('preserves a queued turn snapshot', () => {
    const referencedSessions = [{
      sessionId: 'session-1',
      sessionFile: '.pivi/sessions/one.jsonl',
      title: 'One',
    }];
    const message: QueuedMessage = {
      id: 'queued-1',
      content: 'first',
      editorContext: null,
      canvasContext: null,
      turnRequest: { text: 'first', referencedSessions },
    };

    const queued = toQueuedChatTurn(message);
    expect(queued.request.text).toBe('first');
    expect(queued.request.referencedSessions).toEqual(referencedSessions);
    expect(queued.request.referencedSessions).not.toBe(referencedSessions);
  });
});
