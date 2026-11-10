/**
 * Copies text to the clipboard, falling back to a hidden-textarea +
 * `execCommand('copy')` when the async Clipboard API refuses the call.
 *
 * Electron's renderer frequently rejects `navigator.clipboard.writeText`
 * with "Document is not focused" when the action runs from a menu, dialog
 * or async callback that closed just before the write — the window is still
 * frontmost, but the specific document/iframe lost focus for a tick. The
 * `execCommand` fallback does not carry that focus requirement, so it still
 * succeeds in exactly the cases users reported as a failing copy.
 *
 * Throws only when both paths fail, so existing callers' catch blocks keep
 * their current failure notification unchanged.
 */
export async function copyTextToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        return;
    } catch (error) {
        if (!copyWithExecCommandFallback(text)) {
            throw error;
        }
    }
}

function copyWithExecCommandFallback(text: string): boolean {
    const previousFocus = document.activeElement;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Keep it out of the visible/scrollable viewport and out of tab order.
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.tabIndex = -1;
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);

    try {
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        return document.execCommand('copy');
    } catch {
        return false;
    } finally {
        textarea.remove();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
            previousFocus.focus({ preventScroll: true });
        }
    }
}
