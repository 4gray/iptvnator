import { useState } from 'preact/hooks';

/** A notice owns its recovery action; a storage failure must never reconnect a portal. */
export function useNotice() {
    const [notice, setNotice] = useState<{
        message: string;
        retry?: () => void;
        label?: string;
    }>({ message: '' });
    function setError(message: string, retry?: () => void, label = 'Retry') {
        setNotice({ message, retry, label });
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
