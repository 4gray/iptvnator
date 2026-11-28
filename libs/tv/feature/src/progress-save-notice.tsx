import { restoreFocus } from '@iptvnator/tv/ui';
import { useCallback } from 'preact/hooks';
import type { useProgressSaveNotice } from './use-notice';

export function isProgressSaveNoticeFocused() {
    return !!document.activeElement?.closest('[data-progress-save-notice]');
}

export function ProgressSaveNotice({
    notice,
    focusFallback,
}: {
    notice: ReturnType<typeof useProgressSaveNotice>;
    focusFallback: string;
}) {
    const alertRef = useCallback(
        (element: HTMLDivElement | null) => {
            if (!element) return;
            return () => {
                if (element.contains(document.activeElement)) {
                    restoreFocus(
                        focusFallback,
                        '',
                        undefined,
                        () => document.activeElement === document.body
                    );
                }
            };
        },
        [focusFallback]
    );
    if (!notice.message) return null;
    return (
        <div
            ref={alertRef}
            role="alert"
            class="error"
            data-progress-save-notice
        >
            <span>{notice.message}</span>
            <button onClick={notice.retry}>Retry saving progress</button>
            <button onClick={notice.dismiss}>Dismiss</button>
        </div>
    );
}
