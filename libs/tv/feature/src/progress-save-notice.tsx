import type { useProgressSaveNotice } from './use-notice';

export function ProgressSaveNotice({
    notice,
}: {
    notice: ReturnType<typeof useProgressSaveNotice>;
}) {
    if (!notice.message) return null;
    return (
        <div role="alert" class="error">
            <span>{notice.message}</span>
            <button onClick={notice.retry}>Retry saving progress</button>
            <button onClick={notice.dismiss}>Dismiss</button>
        </div>
    );
}
