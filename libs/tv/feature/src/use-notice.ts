import { useState } from 'preact/hooks';

/** A notice owns its recovery action; a storage failure must never reconnect a portal. */
export function useNotice() {
    const [notice, setNotice] = useState<{
        message: string;
        retry?: () => void;
        label?: string;
    }>({ message: '' });
    function setError(
        message: string,
        retry?: () => void,
        label = 'Retry',
        background = false
    ) {
        setNotice((current) =>
            background && current.retry && current.label !== label
                ? current
                : { message, retry, label }
        );
    }
    return {
        clearError: (label: string) =>
            setNotice((current) =>
                current.label === label ? { message: '' } : current
            ),
        error: notice.message,
        errorRetry: notice.retry,
        errorRetryLabel: notice.label,
        setError,
    };
}

/** Background connection checks cannot replace a foreground recovery action. */
export function connectionNotice(
    notice: Pick<ReturnType<typeof useNotice>, 'setError' | 'clearError'>,
    failed: (value: boolean) => void,
    retry: () => void
) {
    return (message: string) => {
        failed(!!message);
        if (message) notice.setError(message, retry, 'Retry connection', true);
        else notice.clearError('Retry connection');
    };
}

/** Keep the failed write available when playback has its own recovery action. */
export function useProgressSaveNotice() {
    const [notice, setNotice] = useState<{
        message: string;
        save: () => Promise<void>;
    }>();
    return {
        message: notice?.message,
        report: (message: string, save: () => Promise<void>) =>
            setNotice({ message, save }),
        dismiss: () => setNotice(undefined),
        retry: () => {
            if (!notice) return;
            void notice.save().then(
                () =>
                    setNotice((current) =>
                        current === notice ? undefined : current
                    ),
                () => undefined
            );
        },
    };
}
