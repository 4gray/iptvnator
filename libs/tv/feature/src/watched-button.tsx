import { isWatched, type Progress } from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';

export function WatchedButton({
    tv,
    progress,
    beforeChange,
    removed,
    focusKey,
    returnFocus,
}: {
    tv: TvModel;
    progress: Progress;
    beforeChange?: () => void;
    removed?: () => void;
    focusKey?: string;
    returnFocus?: string;
}) {
    return (
        <button
            data-focus={focusKey ?? `watched:${progress.item.id}`}
            onClick={async (event) => {
                const button = event.currentTarget;
                beforeChange?.();
                const saved = await tv.markWatched(
                    progress.item.id,
                    !isWatched(progress),
                    returnFocus ?? focusKey
                );
                if (
                    saved &&
                    !button.isConnected &&
                    document.activeElement === document.body
                )
                    removed?.();
            }}
        >
            {isWatched(progress) ? 'Mark as unwatched' : 'Mark as watched'}
        </button>
    );
}
