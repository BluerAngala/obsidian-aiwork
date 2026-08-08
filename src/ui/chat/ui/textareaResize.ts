export const TEXTAREA_BASE_MIN_HEIGHT = 60;
export const TEXTAREA_MIN_MAX_HEIGHT = 150;
export const TEXTAREA_MAX_HEIGHT_PERCENT = 0.55;

const INPUT_RESIZE_MIN_HEIGHT = 120;
const INPUT_RESIZE_HANDLE_HEIGHT = 6;
const INPUT_RESIZE_RESET_DELAY = 300;

interface TextareaMinHeightInput {
  contentHeight: number;
  flexAllocatedHeight: number;
}

export function calculateTextareaMaxHeight(viewHeight: number): number {
  return Math.max(TEXTAREA_MIN_MAX_HEIGHT, viewHeight * TEXTAREA_MAX_HEIGHT_PERCENT);
}

export function calculateTextareaMinHeight({
  contentHeight,
  flexAllocatedHeight,
}: TextareaMinHeightInput): number {
  return contentHeight > flexAllocatedHeight ? contentHeight : TEXTAREA_BASE_MIN_HEIGHT;
}

/**
 * Auto-resizes a textarea based on its content.
 *
 * Logic:
 * - At minimum wrapper height: let flexbox allocate space (textarea fills available)
 * - When content exceeds flex allocation: set min-height to force wrapper growth
 * - When content shrinks: remove min-height override to let wrapper shrink
 * - Max height is capped at 55% of view height (minimum 150px)
 * - Skips resize when user has manually resized via drag handle
 */
export function autoResizeTextarea(textarea: HTMLTextAreaElement | HTMLElement): void {
  if (textarea.hasAttribute('data-manual-resize')) return;

  const viewHeight = textarea.closest('.pivi-container')?.clientHeight ?? window.innerHeight;
  const maxHeight = calculateTextareaMaxHeight(viewHeight);

  textarea.setCssProps({
    '--pivi-textarea-min-height': `${TEXTAREA_BASE_MIN_HEIGHT}px`,
    '--pivi-textarea-max-height': `${maxHeight}px`,
  });

  const flexAllocatedHeight = textarea.offsetHeight;
  const contentHeight = Math.min(textarea.scrollHeight, maxHeight);
  const minHeight = calculateTextareaMinHeight({ contentHeight, flexAllocatedHeight });

  textarea.setCssProps({
    '--pivi-textarea-min-height': `${minHeight}px`,
    '--pivi-textarea-max-height': `${maxHeight}px`,
  });
}

/**
 * Initializes the drag-to-resize handle on the input wrapper.
 * Allows users to manually resize the input area by dragging.
 * Double-clicking the handle resets to auto-resize mode.
 *
 * @returns Cleanup function to remove all event listeners.
 */
export function initInputResizeHandle(
  handle: HTMLElement,
  wrapper: HTMLElement,
  textarea: HTMLElement,
): () => void {
  const cleanups: Array<() => void> = [];
  let startY = 0;
  let startHeight = 0;
  let lastClickTime = 0;

  const getMaxHeight = (): number => {
    const viewHeight = wrapper.closest('.pivi-container')?.clientHeight ?? window.innerHeight;
    return calculateTextareaMaxHeight(viewHeight);
  };

  const applyHeight = (height: number): void => {
    const clampedHeight = Math.max(INPUT_RESIZE_MIN_HEIGHT, Math.min(height, getMaxHeight()));
    wrapper.setCssProps({ '--pivi-input-wrapper-height': `${clampedHeight}px` });
    textarea.setCssProps({ '--pivi-textarea-min-height': `${clampedHeight - INPUT_RESIZE_HANDLE_HEIGHT}px` });
    textarea.setAttribute('data-manual-resize', '');
  };

  const resetToAutoResize = (): void => {
    wrapper.style.removeProperty('--pivi-input-wrapper-height');
    textarea.style.removeProperty('--pivi-textarea-min-height');
    textarea.removeAttribute('data-manual-resize');
    autoResizeTextarea(textarea);
  };

  const onPointerMove = (e: PointerEvent): void => {
    const delta = startY - e.clientY;
    applyHeight(startHeight + delta);
  };

  const onPointerUp = (): void => {
    handle.classList.remove('is-dragging');
    const ownerDoc = handle.ownerDocument;
    ownerDoc.removeEventListener('pointermove', onPointerMove);
    ownerDoc.removeEventListener('pointerup', onPointerUp);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();

    const now = Date.now();
    if (now - lastClickTime < INPUT_RESIZE_RESET_DELAY) {
      lastClickTime = 0;
      resetToAutoResize();
      return;
    }
    lastClickTime = now;

    handle.classList.add('is-dragging');
    startY = e.clientY;
    startHeight = wrapper.offsetHeight;

    const ownerDoc = handle.ownerDocument;
    ownerDoc.addEventListener('pointermove', onPointerMove);
    ownerDoc.addEventListener('pointerup', onPointerUp);
  };

  handle.addEventListener('pointerdown', onPointerDown);
  cleanups.push(() => handle.removeEventListener('pointerdown', onPointerDown));

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
