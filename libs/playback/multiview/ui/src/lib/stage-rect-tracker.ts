import { signal } from '@angular/core';
import type { TileBox } from './pip-geometry';

export interface StageRects {
    /** The visible content area, relative to the stage host's parent. */
    readonly clip: TileBox;
    /** The anchor placeholder, relative to the clip box. */
    readonly anchor: TileBox;
}

function relative(rect: DOMRect, origin: DOMRect): TileBox {
    return {
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
    };
}

const nextFrame = (run: () => void): void => {
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
    } else {
        setTimeout(run);
    }
};

/**
 * Follows where the anchor placeholder is on screen, so the stage can sit
 * exactly over it (spec 11.1.2). Measures only after a resize or a scroll,
 * at most once per frame, and only while an anchor is observed.
 */
export class StageRectTracker {
    readonly rects = signal<StageRects | null>(null);
    private anchor: HTMLElement | null = null;
    private clip: HTMLElement | null = null;
    private frame: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private scheduled = false;
    private readonly schedule = (): void => {
        if (this.scheduled) return;
        this.scheduled = true;
        nextFrame(() => {
            this.scheduled = false;
            this.measure();
        });
    };

    /** `frame` is the stage host's offset parent, `clip` the scroller. */
    observe(
        anchor: HTMLElement | null,
        clip: HTMLElement | null,
        frame: HTMLElement | null
    ): void {
        this.disconnect();
        this.anchor = anchor;
        this.clip = clip;
        this.frame = frame;
        if (!anchor || !clip || !frame) {
            this.rects.set(null);
            return;
        }
        if (typeof ResizeObserver === 'function') {
            this.resizeObserver = new ResizeObserver(this.schedule);
            for (const element of [anchor, clip, frame]) {
                this.resizeObserver.observe(element);
            }
        }
        // Capture: the anchor may sit in any nested scroller.
        document.addEventListener('scroll', this.schedule, {
            capture: true,
            passive: true,
        });
        window.addEventListener('resize', this.schedule, { passive: true });
        this.measure();
    }

    measure(): void {
        const { anchor, clip, frame } = this;
        if (!anchor || !clip || !frame) return;
        const clipRect = clip.getBoundingClientRect();
        this.rects.set({
            clip: relative(clipRect, frame.getBoundingClientRect()),
            anchor: relative(anchor.getBoundingClientRect(), clipRect),
        });
    }

    disconnect(): void {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        document.removeEventListener('scroll', this.schedule, {
            capture: true,
        });
        window.removeEventListener('resize', this.schedule);
        this.anchor = this.clip = this.frame = null;
    }
}
