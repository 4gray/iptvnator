import { restoreFocus } from '@iptvnator/tv/ui';
import {
    watchState,
    watchPercent,
    type Media,
    type Progress,
} from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';

export function WatchStatus({ progress }: { progress?: Progress }) {
    const state = watchState(progress);
    return (
        <span class="watch-status">
            {state === 'watched'
                ? '✓ Watched'
                : state === 'in-progress'
                  ? `${Math.floor(progress!.seconds / 60)} min watched`
                  : 'Unwatched'}
            {state === 'in-progress' &&
            Number.isFinite(progress?.duration) &&
            progress!.duration > 0 ? (
                <progress
                    aria-label="Viewing progress"
                    max={100}
                    value={watchPercent(progress)}
                />
            ) : null}
        </span>
    );
}
export function WatchActions({ tv, item }: { tv: TvModel; item: Media }) {
    const p = tv.data.positions[item.id];
    return (
        <>
            <button
                onClick={() =>
                    tv.watch(
                        item,
                        watchState(p) === 'watched' ? 'unwatched' : 'watched'
                    )
                }
            >
                {watchState(p) === 'watched'
                    ? 'Mark unwatched'
                    : 'Mark watched'}
            </button>
            {watchState(p) !== 'unwatched' ? (
                <>
                    <button
                        onClick={async (event) => {
                            const button = event.currentTarget;
                            if (await tv.watch(item, 'reset', 'detail-play'))
                                restoreFocus(
                                    'detail-play',
                                    '',
                                    undefined,
                                    () =>
                                        !button.isConnected &&
                                        document.activeElement === document.body
                                );
                        }}
                    >
                        Reset progress
                    </button>
                    <button onClick={() => tv.startOver(item)}>
                        Start over
                    </button>
                </>
            ) : null}
        </>
    );
}
