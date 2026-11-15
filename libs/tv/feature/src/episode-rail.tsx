import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { HorizontalRail } from '@iptvnator/tv/ui';
import { episodeCode, type Media } from '@iptvnator/tv/util';
import type { TvModel } from './use-tv';
import { EpisodeCard } from './episode-card';
import { MoreActions, WatchOptions } from './watch-actions';

/** Episodes kept in the DOM on each side of the selected one. */
const BEFORE = 8;
const AFTER = 16;
/** Episodes kept around the scrolled-to left edge: a screen and a bit. */
const SCROLL_BEFORE = 2;
const SCROLL_AFTER = 8;
const isKey = (event: KeyboardEvent, key: string, code: number) =>
    event.key === key || event.keyCode === code;

/**
 * Episode ranges to render: one around the selected episode and, when the
 * rail was scrolled elsewhere, one around the visible part. Overlapping
 * ranges merge; the result is sorted and non-empty for a non-empty season.
 */
export function windowRanges(
    count: number,
    selected: number,
    visible: number | null
): [number, number][] {
    const around = (
        center: number,
        before: number,
        after: number
    ): [number, number] => [
        Math.max(0, center - before),
        Math.min(count, center + after),
    ];
    const ranges = [around(selected, BEFORE, AFTER)];
    if (visible !== null)
        ranges.push(
            around(Math.min(visible, count - 1), SCROLL_BEFORE, SCROLL_AFTER)
        );
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push([range[0], range[1]]);
    }
    return merged;
}

/**
 * A horizontal episode rail. Long seasons are windowed around the selected
 * episode and the scrolled-to part; spacers keep scroll coordinates stable.
 * The focused episode's description and its one options button sit under
 * the rail.
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
    /** First episode visible in the rail, from its scroll position. */
    const [visible, setVisible] = useState<number | null>(null);
    const index = Math.min(selected, Math.max(0, episodes.length - 1));
    const ranges = windowRanges(episodes.length, index, visible);
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
    // One flat keyed list: an episode keeps its button (and focus) when the
    // window splits or merges around it.
    const tiles = [];
    let rendered = 0;
    for (const [from, to] of ranges) {
        if (from > rendered)
            tiles.push(
                <span
                    key={`spacer-${rendered}`}
                    class="episode-spacer"
                    aria-hidden="true"
                    style={{ width: `${(from - rendered) * step}px` }}
                />
            );
        for (let i = from; i < to; i++)
            tiles.push(
                <EpisodeCard
                    key={episodes[i].id}
                    tv={tv}
                    item={episodes[i]}
                    index={i}
                    onFocus={() => setSelected(i)}
                />
            );
        rendered = to;
    }
    if (rendered < episodes.length)
        tiles.push(
            <span
                key={`spacer-${rendered}`}
                class="episode-spacer"
                aria-hidden="true"
                style={{
                    width: `${(episodes.length - rendered) * step}px`,
                }}
            />
        );
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
                    onScroll={(event) => {
                        // Pointer and wheel scrolling move the rendered window
                        // too; the selected episode stays mounted.
                        const left = event.currentTarget.scrollLeft;
                        setVisible(Math.max(0, Math.floor(left / step)));
                    }}
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
                    {tiles}
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
