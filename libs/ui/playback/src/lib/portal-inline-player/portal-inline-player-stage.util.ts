/** Narrowest useful "Up Next" rail; below this the stage stays centered. */
export const UP_NEXT_RAIL_MIN_WIDTH = 320;
/** Keep in sync with `.player-shell__viewport--with-rail` in the stylesheet. */
const RAIL_STAGE_PADDING = 12;
const RAIL_STAGE_GAP = 18;

export interface StageSize {
    width: number;
    height: number;
}

/**
 * Width the rail would actually get: the stage minus its docked-mode
 * padding, the 16:9 player sized to the remaining height, and the flex gap.
 * Computed for the docked layout even while centered, so the gate answers
 * "would the rail fit?" rather than "is there slack right now?".
 */
export function upNextRailAvailableWidth(size: StageSize | null): number {
    if (!size || size.height <= 0) {
        return 0;
    }

    const innerWidth = size.width - RAIL_STAGE_PADDING * 2;
    const innerHeight = size.height - RAIL_STAGE_PADDING * 2;
    return innerWidth - (innerHeight * 16) / 9 - RAIL_STAGE_GAP;
}

/** Safe `url(...)` value, or null when the poster URL is not a plain http/data URL. */
export function ambientImageStyle(
    url: string | null | undefined
): string | null {
    if (!url || !/^(https?:|data:)/i.test(url)) {
        return null;
    }

    const safe = url.replace(/"/g, '%22').replace(/\\/g, '%5C');
    return `url("${safe}")`;
}

/**
 * Reports the element's border-box size through a ResizeObserver and returns
 * the disconnect callback. Measuring the border box (not the content box)
 * keeps the value stable when the rail modifier toggles the stage's own
 * padding, so the rail gate cannot oscillate around its threshold.
 */
export function observeStageSize(
    element: HTMLElement,
    onSize: (size: StageSize) => void
): () => void {
    const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
            return;
        }

        // `borderBoxSize` is the padding-independent measurement; the
        // `contentRect` fallback covers engines that omit it.
        const borderBox = entry.borderBoxSize?.[0];
        onSize(
            borderBox
                ? { width: borderBox.inlineSize, height: borderBox.blockSize }
                : {
                      width: entry.contentRect.width,
                      height: entry.contentRect.height,
                  }
        );
    });
    observer.observe(element);
    return () => observer.disconnect();
}
