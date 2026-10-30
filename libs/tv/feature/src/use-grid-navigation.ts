import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { TimelineAxis } from '@iptvnator/shared/epg';
import {
    GUIDE_SPAN,
    gridProgramAt,
    GuideProgram,
    Media,
} from '@iptvnator/tv/util';
import type { GridSchedule } from './use-grid-guide';
export interface GridSelection {
    row: number;
    key: string;
    time: number;
}
export function useGridNavigation(
    items: Media[],
    schedules: Map<string, GridSchedule>,
    axis: TimelineAxis,
    setAxis: (axis: TimelineAxis) => void,
    loadMore: () => void,
    more: boolean
) {
    const list = useRef<HTMLDivElement>(null);
    const pending = useRef(false);
    const append = useRef<GridSelection>();
    const [scroll, setScroll] = useState(0);
    const [selection, select] = useState<GridSelection>({
        row: 0,
        key: 'channel',
        time: Date.now(),
    });
    const programs = (row: number) =>
        schedules.get(items[row]?.id)?.programs ?? [];
    const focus = (
        row: number,
        channel: boolean,
        time: number,
        window = axis
    ) => {
        if (!items[row]) return;
        const program = gridProgramAt(programs(row), window, time);
        select({
            row,
            key: channel ? 'channel' : (program?.id ?? 'empty'),
            time,
        });
        pending.current = true;
        const pane = list.current;
        if (pane) {
            if (row * 88 < pane.scrollTop) pane.scrollTop = row * 88;
            if ((row + 1) * 88 > pane.scrollTop + pane.clientHeight)
                pane.scrollTop = (row + 1) * 88 - pane.clientHeight;
            setScroll(pane.scrollTop);
        }
    };
    useLayoutEffect(() => {
        if (append.current) {
            const requested = append.current;
            const active = document.activeElement as HTMLElement;
            if (
                selection.row !== requested.row ||
                selection.key !== requested.key ||
                Number(active.dataset.gridRow) !== requested.row
            )
                append.current = undefined;
            else if (items[requested.row + 1]) {
                append.current = undefined;
                focus(
                    requested.row + 1,
                    requested.key === 'channel',
                    requested.time
                );
                return;
            }
        }
        // A refreshed schedule may replace the focused programme DOM node.
        if (
            document.activeElement === document.body &&
            selection.key !== 'channel'
        ) {
            const target =
                gridProgramAt(programs(selection.row), axis, selection.time)
                    ?.id ?? 'empty';
            if (target !== selection.key) {
                focus(selection.row, false, selection.time);
                return;
            }
        }
        if (!pending.current) return;
        const button = Array.from(
            list.current?.querySelectorAll<HTMLElement>('[data-grid-key]') ?? []
        ).find(
            (el) =>
                Number(el.dataset.gridRow) === selection.row &&
                el.dataset.gridKey === selection.key
        );
        if (button) {
            button.focus({ preventScroll: true });
            pending.current = false;
        }
    });
    function key(
        event: JSX.TargetedKeyboardEvent<HTMLElement>,
        row: number,
        program?: GuideProgram,
        channel = false
    ) {
        if (!event.key.startsWith('Arrow')) return;
        event.preventDefault();
        event.stopPropagation();
        append.current = undefined;
        const time = selection.time;
        if (event.key === 'ArrowUp') {
            if (!row)
                document
                    .querySelector<HTMLElement>('[data-focus="grid-now"]')
                    ?.focus();
            else focus(row - 1, channel, time);
        } else if (event.key === 'ArrowDown') {
            if (row + 1 < items.length) focus(row + 1, channel, time);
            else if (more) {
                append.current = { ...selection };
                loadMore();
            } else
                document
                    .querySelector<HTMLElement>('[data-focus="grid-watch"]')
                    ?.focus();
        } else if (event.key === 'ArrowRight' && channel)
            focus(row, false, time);
        else if (event.key === 'ArrowLeft' && channel)
            document
                .querySelector<HTMLElement>('[data-focus="grid-category"]')
                ?.focus();
        else {
            const rows = programs(row);
            const index = rows.findIndex((p) => p.id === program?.id);
            const next =
                index >= 0
                    ? rows[index + (event.key === 'ArrowRight' ? 1 : -1)]
                    : undefined;
            if (next) {
                const point =
                    next.start + Math.min(60000, (next.end - next.start) / 2);
                const window =
                    point < axis.startMs || point >= axis.endMs
                        ? {
                              startMs: next.start,
                              endMs: next.start + GUIDE_SPAN,
                          }
                        : axis;
                setAxis(window);
                focus(row, false, point, window);
            } else if (event.key === 'ArrowLeft') focus(row, true, time);
            else {
                const window = {
                    startMs: axis.endMs,
                    endMs: axis.endMs + GUIDE_SPAN,
                };
                setAxis(window);
                focus(row, false, window.startMs, window);
            }
        }
    }
    return {
        list,
        scroll,
        setScroll,
        selection,
        focus,
        key,
        onFocus: (row: number, key: string, time: number) =>
            select((current) =>
                current.row === row && current.key === key
                    ? current
                    : { row, key, time }
            ),
    };
}
