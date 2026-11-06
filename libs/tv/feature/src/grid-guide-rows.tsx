import {
    buildGuideTicks,
    clipGuideSpan,
    guideNowLeftPx,
    guideXForMs,
    TimelineAxis,
} from '@iptvnator/shared/epg';
import { gridTime, gridVisiblePrograms, Media } from '@iptvnator/tv/util';
import { ChannelLogo } from '@iptvnator/tv/ui';
import type { GridSchedule } from './use-grid-guide';
import type { useGridNavigation } from './use-grid-navigation';
export function GridGuideRows({
    items,
    indices,
    schedules,
    axis,
    now,
    navigation,
    playingId,
    message,
    inspect,
    loadMore,
    more,
    busy,
    error,
}: {
    items: Media[];
    indices: number[];
    schedules: Map<string, GridSchedule>;
    axis: TimelineAxis;
    now: number;
    navigation: ReturnType<typeof useGridNavigation>;
    playingId?: string;
    message: string;
    inspect: () => void;
    loadMore: () => void;
    more: boolean;
    busy: boolean;
    error: string;
}) {
    const nowLeft = guideNowLeftPx(axis, now, 50);
    return (
        <>
            <div class="grid-axis" aria-hidden="true">
                <span>Channel</span>
                <div>
                    {buildGuideTicks(axis, 50).map((tick) => (
                        <time key={tick.ms} style={{ left: `${tick.leftPx}%` }}>
                            {gridTime(tick.ms)}
                        </time>
                    ))}
                </div>
            </div>
            <div
                class="grid-scroll"
                ref={navigation.list}
                onScroll={(event) => {
                    const pane = event.currentTarget;
                    navigation.setScroll(pane.scrollTop);
                    if (
                        more &&
                        !busy &&
                        !error &&
                        pane.scrollTop + pane.clientHeight + 176 >=
                            items.length * 88
                    )
                        loadMore();
                }}
            >
                <div
                    class="grid-row-space"
                    style={{ height: `${items.length * 88}px` }}
                >
                    {indices.map((row) => {
                        const item = items[row];
                        const schedule = schedules.get(item.id);
                        const selectedKey =
                            navigation.selection.row === row
                                ? navigation.selection.key
                                : '';
                        const programs = gridVisiblePrograms(
                            schedule?.programs ?? [],
                            axis,
                            selectedKey
                        );
                        return (
                            <div
                                class="grid-channel-row"
                                key={item.id}
                                style={{ top: `${row * 88}px` }}
                            >
                                <button
                                    class={`grid-channel ${playingId === item.id ? 'is-playing' : ''}`}
                                    data-grid-row={row}
                                    data-grid-key="channel"
                                    aria-label={item.title}
                                    onFocus={() =>
                                        navigation.onFocus(
                                            row,
                                            'channel',
                                            navigation.selection.time
                                        )
                                    }
                                    onKeyDown={(e) =>
                                        navigation.key(e, row, undefined, true)
                                    }
                                    onClick={inspect}
                                >
                                    <ChannelLogo src={item.poster} />
                                    <span>
                                        <strong>{item.title}</strong>
                                        <small>
                                            {playingId === item.id
                                                ? '● Playing'
                                                : String(row + 1).padStart(
                                                      2,
                                                      '0'
                                                  )}
                                        </small>
                                    </span>
                                </button>
                                <div class="grid-program-track">
                                    {nowLeft !== null ? (
                                        <span
                                            class="grid-now-line"
                                            style={{ left: `${nowLeft}%` }}
                                            aria-hidden="true"
                                        />
                                    ) : null}
                                    {programs.map((p) => {
                                        const clipped = clipGuideSpan(
                                            axis,
                                            p.start,
                                            p.end
                                        );
                                        if (!clipped) return null;
                                        return (
                                            <button
                                                key={p.id}
                                                class={`grid-program ${p.start <= now && p.end > now ? 'on-air' : ''}`}
                                                style={{
                                                    left: `${guideXForMs(axis, clipped.startMs, 50)}%`,
                                                    width: `${guideXForMs(clipped, clipped.endMs, 50)}%`,
                                                }}
                                                data-grid-row={row}
                                                data-grid-key={p.id}
                                                title={`${gridTime(p.start)}–${gridTime(p.end)} ${p.title}`}
                                                onFocus={() =>
                                                    navigation.onFocus(
                                                        row,
                                                        p.id,
                                                        Math.max(
                                                            p.start,
                                                            axis.startMs
                                                        ) + 1
                                                    )
                                                }
                                                onKeyDown={(e) =>
                                                    navigation.key(e, row, p)
                                                }
                                                onClick={inspect}
                                            >
                                                <time>{gridTime(p.start)}</time>
                                                <strong>{p.title}</strong>
                                            </button>
                                        );
                                    })}
                                    {!programs.length ? (
                                        <button
                                            class="grid-empty"
                                            data-grid-row={row}
                                            data-grid-key="empty"
                                            onFocus={() =>
                                                navigation.onFocus(
                                                    row,
                                                    'empty',
                                                    navigation.selection.time
                                                )
                                            }
                                            onKeyDown={(e) =>
                                                navigation.key(e, row)
                                            }
                                            onClick={inspect}
                                        >
                                            {message ||
                                                (schedule?.status === 'error'
                                                    ? 'Programme unavailable · Retry below'
                                                    : !schedule ||
                                                        schedule.status ===
                                                            'loading'
                                                      ? 'Loading programme…'
                                                      : 'No programme supplied for this time')}
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
                {busy || error ? (
                    <div class="grid-loading" role="status">
                        {error || 'Loading channels…'}
                        {error ? (
                            <button onClick={loadMore}>Retry channels</button>
                        ) : null}
                    </div>
                ) : null}
                {!busy && !error && !items.length ? (
                    <p>No channels in this category.</p>
                ) : null}
            </div>
        </>
    );
}
