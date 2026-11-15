import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { TvDialog } from '@iptvnator/tv/ui';
import {
    progressSummary,
    watchState,
    watchPercent,
    type Media,
    type Progress,
} from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';
import { navigationOrigin } from './use-route-history';

/** Bar and words come from one position, so they always agree. */
export function WatchStatus({ progress }: { progress?: Progress }) {
    const state = watchState(progress);
    if (!progress || state === 'unwatched') return null;
    if (state === 'watched') return <span class="watch-status">✓ Watched</span>;
    const known = Number.isFinite(progress.duration) && progress.duration > 0;
    return (
        <span class="watch-status in-progress">
            {known ? (
                <progress
                    aria-label="Viewing progress"
                    max={100}
                    value={watchPercent(progress)}
                />
            ) : null}
            <span>{progressSummary(progress)}</span>
        </span>
    );
}

/** A "⋯" button that keeps rare actions out of the primary row. */
export function MoreActions({
    title,
    focusKey,
    label = 'More actions',
    text = '⋯',
    className = 'more-actions',
    onKeyDown,
    children,
}: {
    title: string;
    focusKey: string;
    label?: string;
    text?: ComponentChildren;
    className?: string;
    onKeyDown?: (event: KeyboardEvent) => void;
    children: (close: () => void) => ComponentChildren;
}) {
    const [open, setOpen] = useState(false);
    const close = () => setOpen(false);
    return (
        <>
            <button
                class={className}
                data-focus={focusKey}
                aria-label={label}
                aria-haspopup="dialog"
                onKeyDown={onKeyDown}
                onClick={() => setOpen(true)}
            >
                {text}
            </button>
            {open ? (
                <TvDialog title={title} close={close} className="tv-card-menu">
                    <div
                        class="tv-card-options"
                        role="group"
                        aria-label="Title actions"
                    >
                        {children(close)}
                    </div>
                </TvDialog>
            ) : null}
        </>
    );
}

/** Mark watched, reset and (for episodes) start over, inside a ⋯ menu. */
export function WatchOptions({
    tv,
    item,
    close,
    returnFocus,
    startOver = false,
}: {
    tv: TvModel;
    item: Media;
    close: () => void;
    returnFocus: string;
    startOver?: boolean;
}) {
    const state = watchState(tv.data.positions[item.id]);
    return (
        <>
            <button
                data-dialog-initial
                onClick={() => {
                    close();
                    void tv.watch(
                        item,
                        state === 'watched' ? 'unwatched' : 'watched',
                        returnFocus
                    );
                }}
            >
                {state === 'watched' ? 'Mark unwatched' : 'Mark watched'}
            </button>
            {state !== 'unwatched' ? (
                <button
                    onClick={() => {
                        close();
                        void tv.watch(item, 'reset', returnFocus);
                    }}
                >
                    Reset progress
                </button>
            ) : null}
            {startOver && state === 'in-progress' ? (
                <button
                    onClick={() => {
                        close();
                        void tv.startOver(item, navigationOrigin(returnFocus));
                    }}
                >
                    Start over
                </button>
            ) : null}
        </>
    );
}
