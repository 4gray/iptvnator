import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { TvIcon } from './icon';

export function HorizontalRail({
    label,
    children,
}: {
    label: string;
    children: ComponentChildren;
}) {
    const root = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({
        overflow: false,
        left: false,
        right: false,
    });
    const scroller = () =>
        root.current?.querySelector<HTMLElement>('[data-tv-horizontal]');
    const measure = () => {
        const row = scroller();
        if (!row) return;
        const end = row.scrollWidth - row.clientWidth;
        const next = {
            overflow: end > 1,
            left: row.scrollLeft > 1,
            right: row.scrollLeft < end - 1,
        };
        setEdges((previous) =>
            previous.overflow === next.overflow &&
            previous.left === next.left &&
            previous.right === next.right
                ? previous
                : next
        );
    };
    useLayoutEffect(measure);
    useEffect(() => {
        const row = scroller();
        row?.addEventListener('scroll', measure, { passive: true });
        window.addEventListener('resize', measure);
        return () => {
            row?.removeEventListener('scroll', measure);
            window.removeEventListener('resize', measure);
        };
    }, []);
    const page = (direction: number) => {
        const row = scroller();
        if (!row) return;
        const bounds = row.getBoundingClientRect();
        const items = Array.from(
            row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        );
        const target = (direction > 0 ? items : items.reverse()).find(
            (item) => {
                const rect = item.getBoundingClientRect();
                return direction > 0
                    ? rect.right > bounds.right + 1
                    : rect.left < bounds.left - 1;
            }
        );
        if (target) {
            target.focus({ preventScroll: true });
            target.scrollIntoView({
                block: 'nearest',
                inline: direction > 0 ? 'start' : 'end',
            });
        } else row.scrollLeft += direction * row.clientWidth;
        measure();
    };
    return (
        <div class="horizontal-rail" ref={root}>
            {children}
            {edges.overflow
                ? ([-1, 1] as const).map((direction) => (
                      <button
                          key={direction}
                          class={`rail-arrow rail-arrow-${direction < 0 ? 'left' : 'right'}`}
                          data-tv-pointer-only
                          tabIndex={-1}
                          disabled={direction < 0 ? !edges.left : !edges.right}
                          aria-label={`Scroll ${direction < 0 ? 'left' : 'right'}: ${label}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => page(direction)}
                      >
                          <TvIcon
                              name={
                                  direction < 0
                                      ? 'chevron-left'
                                      : 'chevron-right'
                              }
                          />
                      </button>
                  ))
                : null}
        </div>
    );
}
