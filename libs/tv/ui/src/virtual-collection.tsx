import { cloneElement, VNode } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Window the DOM while retaining loaded data and stable scroll coordinates. */
export function VirtualCollection<T extends { id: string }>({
    items,
    layout = 'posters',
    more = false,
    busy = false,
    error = '',
    loadMore = () => undefined,
    restoreKey = '',
    restoreScroll,
    render,
}: {
    items: T[];
    layout?: 'posters' | 'channels' | 'episodes' | 'stations';
    more?: boolean;
    busy?: boolean;
    error?: string;
    loadMore?: () => void;
    restoreKey?: string;
    restoreScroll?: number;
    render: (item: T, index: number) => VNode;
}) {
    const outer = useRef<HTMLDivElement>(null);
    const grid = useRef<HTMLDivElement>(null);
    const initialColumns =
        layout === 'channels'
            ? 1
            : layout === 'episodes' || layout === 'stations'
              ? innerWidth <= 900
                  ? 2
                  : 3
              : innerWidth <= 900
                ? 3
                : innerWidth <= 1400
                  ? 5
                  : 6;
    const [windowed, setWindow] = useState(() => ({
        row: Math.max(
            0,
            Math.floor(
                items.findIndex((x) => x.id === restoreKey) / initialColumns
            ) - 2
        ),
        columns: initialColumns,
        step: layout === 'channels' ? 95 : layout === 'episodes' ? 200 : 430,
    }));
    const pending = useRef<number>();
    const focusAfterRender = useRef<number>();
    const latest = useRef({ items, more, busy, error, loadMore, windowed });
    latest.current = { items, more, busy, error, loadMore, windowed };
    const rows = layout === 'channels' ? 20 : 10;
    const start = windowed.row * windowed.columns;
    const end = Math.min(items.length, start + rows * windowed.columns);
    const update = useRef<() => void>();
    useLayoutEffect(() => {
        const element = outer.current!;
        const root =
            layout === 'channels'
                ? element.closest<HTMLElement>('.channels')!
                : document.querySelector('main')!;
        if (restoreScroll !== undefined) root.scrollTop = restoreScroll;
        let frame = 0;
        let restoreChannel =
            layout === 'channels' &&
            restoreScroll === undefined &&
            !!restoreKey;
        const measure = () => {
            const current = latest.current;
            const first = grid.current?.querySelector<HTMLElement>(
                '[data-virtual-index]'
            );
            if (!first || !element.offsetWidth || !root.clientHeight) return;
            const style = getComputedStyle(grid.current!);
            const columns =
                layout === 'channels'
                    ? 1
                    : style.gridTemplateColumns.split(' ').filter(Boolean)
                          .length;
            const gap =
                parseFloat(style.rowGap) || (layout === 'channels' ? 9 : 0);
            const step = first.getBoundingClientRect().height + gap;
            if (restoreChannel) {
                const index = current.items.findIndex(
                    (item) => item.id === restoreKey
                );
                if (index >= 0) {
                    root.scrollTop = Math.max(0, index - 2) * step;
                    restoreChannel = false;
                }
            }
            const relative = Math.max(
                0,
                root.getBoundingClientRect().top -
                    element.getBoundingClientRect().top
            );
            let row = Math.max(0, Math.floor(relative / step) - 2);
            row = Math.min(
                row,
                Math.max(0, Math.ceil(current.items.length / columns) - rows)
            );
            const active = document.activeElement as HTMLElement;
            if (element.contains(active) && active.dataset.virtualIndex) {
                const index = Number(active.dataset.virtualIndex);
                if (index < row * columns || index >= (row + rows) * columns)
                    focusAfterRender.current = Math.min(
                        current.items.length - 1,
                        (row + 2) * columns + (index % columns)
                    );
            }
            if (
                row !== current.windowed.row ||
                columns !== current.windowed.columns ||
                Math.abs(step - current.windowed.step) > 1
            )
                setWindow({ row, columns, step });
            if (
                current.more &&
                !current.busy &&
                !current.error &&
                relative + root.clientHeight + step >=
                    Math.ceil(current.items.length / columns) * step
            )
                current.loadMore();
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };
        update.current = schedule;
        root.addEventListener('scroll', schedule);
        window.addEventListener('resize', schedule);
        schedule();
        return () => {
            cancelAnimationFrame(frame);
            root.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
        };
    }, [layout]);
    useLayoutEffect(() => {
        if (pending.current !== undefined && pending.current < items.length) {
            focusAfterRender.current = pending.current;
            setWindow((w) => ({
                ...w,
                row: Math.max(0, Math.floor(pending.current! / w.columns) - 2),
            }));
            pending.current = undefined;
        }
        const index = focusAfterRender.current;
        const target =
            index === undefined
                ? null
                : grid.current?.querySelector<HTMLElement>(
                      `[data-virtual-index="${index}"]`
                  );
        if (target) {
            target.focus({ preventScroll: true });
            target.scrollIntoView({ block: 'nearest' });
            focusAfterRender.current = undefined;
        }
        update.current?.();
    });
    return (
        <div
            class="virtual-collection"
            ref={outer}
            data-loaded={items.length}
            onKeyDown={(event) => {
                const target = event.target as HTMLElement;
                const down = event.key === 'ArrowDown' || event.keyCode === 40;
                const up = event.key === 'ArrowUp' || event.keyCode === 38;
                const right =
                    event.key === 'ArrowRight' || event.keyCode === 39;
                const left = event.key === 'ArrowLeft' || event.keyCode === 37;
                if ((right || left) && target.dataset.virtualIndex) {
                    const index = Number(target.dataset.virtualIndex);
                    const next = index + (right ? 1 : -1);
                    const sameRow =
                        Math.floor(index / windowed.columns) ===
                        Math.floor(next / windowed.columns);
                    const destination = sameRow
                        ? grid.current?.querySelector<HTMLElement>(
                              `[data-virtual-index="${next}"]`
                          )
                        : null;
                    if (destination) {
                        event.preventDefault();
                        event.stopPropagation();
                        destination.focus();
                        destination.scrollIntoView({ block: 'nearest' });
                    }
                }
                if ((down || up) && target.dataset.virtualIndex) {
                    const next =
                        Number(target.dataset.virtualIndex) +
                        (down ? windowed.columns : -windowed.columns);
                    if (next >= 0 && next < items.length) {
                        event.preventDefault();
                        event.stopPropagation();
                        const destination =
                            grid.current?.querySelector<HTMLElement>(
                                `[data-virtual-index="${next}"]`
                            );
                        if (destination) {
                            destination.focus();
                            destination.scrollIntoView({ block: 'nearest' });
                        } else {
                            focusAfterRender.current = next;
                            setWindow((w) => ({
                                ...w,
                                row: Math.max(
                                    0,
                                    Math.floor(next / w.columns) - 2
                                ),
                            }));
                        }
                    } else if (down && more && !error) {
                        event.preventDefault();
                        event.stopPropagation();
                        pending.current = next;
                        if (!busy) loadMore();
                    }
                }
            }}
        >
            <div
                aria-hidden="true"
                style={{ height: (start / windowed.columns) * windowed.step }}
            />
            <div
                ref={grid}
                class={
                    layout === 'posters'
                        ? 'poster-grid'
                        : layout === 'stations'
                          ? 'station-grid'
                          : layout === 'episodes'
                            ? 'episode-grid'
                            : 'channel-window'
                }
            >
                {items.slice(start, end).map((item, offset) =>
                    cloneElement(render(item, start + offset), {
                        key: item.id,
                        'data-virtual-index': start + offset,
                    })
                )}
            </div>
            <div
                aria-hidden="true"
                style={{
                    height:
                        Math.max(
                            0,
                            Math.ceil(items.length / windowed.columns) -
                                Math.ceil(end / windowed.columns)
                        ) * windowed.step,
                }}
            />
            {busy ? (
                <p class="load-more-status" role="status">
                    Loading more…
                </p>
            ) : error ? (
                <div class="load-more-status" role="alert">
                    {error} <button onClick={loadMore}>Retry loading</button>
                </div>
            ) : null}
        </div>
    );
}
