import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { HorizontalRail } from '@iptvnator/tv/ui';
import { episodeCode, type Media } from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';
import { EpisodeCard } from './episode-card';
import { MoreActions, WatchOptions } from './watch-actions';

/** Episodes kept in the DOM on each side of the selected one. */
const BEFORE = 8;
const AFTER = 16;
const isKey = (event: KeyboardEvent, key: string, code: number) =>
    event.key === key || event.keyCode === code;

/**
 * A horizontal episode rail. Long seasons are windowed around the selected
 * episode; spacers keep scroll coordinates stable. The focused episode's
 * description and its one options button sit under the rail.
 */
export function EpisodeRail({
    tv,
    episodes,
    initial,
}: {
    tv: TvModel;
    episodes: Media[];
    /** Episode to show first (restored focus or the next one to watch). */
    initial?: string;
}) {
    const row = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState(() =>
        Math.max(
            0,
            episodes.findIndex((e) => e.id === initial)
        )
    );
    const [step, setStep] = useState(480);
    const index = Math.min(selected, Math.max(0, episodes.length - 1));
    const start = Math.max(0, index - BEFORE);
    const end = Math.min(episodes.length, index + AFTER);
    const current = episodes[index];
    useLayoutEffect(() => {
        const first = row.current?.querySelector<HTMLElement>('.episode');
        if (!first) return;
        const measured =
            first.offsetWidth +
            (parseFloat(getComputedStyle(first).marginRight) || 0);
        if (measured > 0 && Math.abs(measured - step) > 1) setStep(measured);
    });
    const placed = useRef(false);
    useLayoutEffect(() => {
        // Show the starting episode at the rail's left edge. Repeat once the
        // card step is measured: the spacer width depends on it. Once the
        // viewer moves within the rail, focus scrolling owns the position.
        const element = row.current;
        if (!element || placed.current) return;
        if (element.contains(document.activeElement)) {
            placed.current = true;
            return;
        }
        const tile = element.querySelector<HTMLElement>(
            `[data-episode-index="${index}"]`
        );
        if (!tile) return;
        if (index > 0)
            element.scrollLeft = tile.offsetLeft - element.offsetLeft - 16;
        const measured =
            tile.offsetWidth +
            (parseFloat(getComputedStyle(tile).marginRight) || 0);
        placed.current = Math.abs(measured - step) <= 1;
    }, [step]);
    if (!current) return null;
    const focusSelected = () =>
        row.current
            ?.querySelector<HTMLElement>(`[data-episode-index="${index}"]`)
            ?.focus();
    return (
        <>
            <HorizontalRail label="Episodes">
                <div
                    class="rail episode-rail"
                    data-tv-horizontal
                    ref={row}
                    onKeyDown={(event) => {
                        if (!isKey(event, 'ArrowDown', 40)) return;
                        const options =
                            row.current?.parentElement?.parentElement?.querySelector<HTMLElement>(
                                '[data-focus="episode-options"]'
                            );
                        if (!options) return;
                        event.preventDefault();
                        event.stopPropagation();
                        options.focus();
                    }}
                >
                    {start ? (
                        <span
                            class="episode-spacer"
                            aria-hidden="true"
                            style={{ width: `${start * step}px` }}
                        />
                    ) : null}
                    {episodes.slice(start, end).map((e, offset) => (
                        <EpisodeCard
                            key={e.id}
                            tv={tv}
                            item={e}
                            index={start + offset}
                            onFocus={() => setSelected(start + offset)}
                        />
                    ))}
                    {end < episodes.length ? (
                        <span
                            class="episode-spacer"
                            aria-hidden="true"
                            style={{
                                width: `${(episodes.length - end) * step}px`,
                            }}
                        />
                    ) : null}
                </div>
            </HorizontalRail>
            <div class="episode-focus">
                <p>
                    <strong>
                        {episodeCode(current)} · {current.title}
                    </strong>
                    {current.description ? ' ' : null}
                    {current.description ? (
                        <span class="episode-description">
                            {current.description}
                        </span>
                    ) : null}
                </p>
                <MoreActions
                    title={`${episodeCode(current)} · ${current.title}`}
                    focusKey="episode-options"
                    label={`Episode options · ${episodeCode(current)} · ${current.title}`}
                    text="⋯ Episode options"
                    className="episode-options"
                    onKeyDown={(event) => {
                        if (!isKey(event, 'ArrowUp', 38)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        focusSelected();
                    }}
                >
                    {(close) => (
                        <WatchOptions
                            tv={tv}
                            item={current}
                            close={close}
                            returnFocus={current.id}
                            startOver
                        />
                    )}
                </MoreActions>
            </div>
        </>
    );
}
