import { TabPiviManagementApprovalBridge } from '@/ui/chat/composer/TabPiviManagementApprovalBridge';
import { buildPiviManagementApprovalPrompt, parsePiviManagementDecision } from '@/ui/chat/composer/piviManagementApprovalPrompt';
import type { InputController } from '@/ui/chat/controllers/InputController';

const plan = { domain: 'commands' as const, action: 'upsert', title: 'Update command', revision: 4,
  changeLines: ['Rename Daily to Today'], fields: [{ label: 'Icon', value: 'calendar' }] };

describe('Pivi management approval', () => {
  it('shows normalized content with only confirm and deny', () => {
    const prompt = buildPiviManagementApprovalPrompt(plan);
    const question = (prompt.input.questions as Array<{ question: string; options: Array<{ value: string }> }>)[0]!;
    expect(question.question).toContain('Rename Daily to Today');
    expect(question.question).toContain('Icon: calendar');
    expect(question.options.map(({ value }) => value)).toEqual(['confirm', 'deny']);
  });

  it.each([['confirm', 'confirm'], ['deny', 'deny'], [null, 'cancel']] as const)(
    'normalizes %s to %s', (value, expected) => {
      expect(parsePiviManagementDecision(value ? { answer: value } : null)).toBe(expected);
    },
  );

  it('permits one pending request and aborts without a late decision', async () => {
    let resolveUi!: (decision: 'confirm') => void;
    const controller = {
      handlePiviManagementApproval: jest.fn(() => new Promise<'confirm'>((resolve) => { resolveUi = resolve; })),
      dismissPendingInlinePrompts: jest.fn(),
    } as unknown as InputController;
    const bridge = new TabPiviManagementApprovalBridge();
    bridge.bindInputController(controller);
    const abort = new AbortController();
    const first = bridge.requestApproval(plan, abort.signal);
    await expect(bridge.requestApproval(plan)).resolves.toBe('cancel');
    abort.abort();
    await expect(first).resolves.toBe('cancel');
    resolveUi('confirm');
    await Promise.resolve();
    expect(controller.dismissPendingInlinePrompts).toHaveBeenCalledTimes(1);
  });

  it('fails closed unbound and disposed', async () => {
    const bridge = new TabPiviManagementApprovalBridge();
    await expect(bridge.requestApproval(plan)).resolves.toBe('cancel');
    bridge.dispose();
    await expect(bridge.requestApproval(plan)).resolves.toBe('cancel');
  });
});
