import type { Page } from '@playwright/test';
import { expect } from './electron-test-fixtures';

export interface Box {
    top: number;
    left: number;
    width: number;
    height: number;
    bottom: number;
}

export interface LayoutShiftReport {
    score: number;
    shifts: {
        value: number;
        sources: { node: string; deltaY: number; deltaHeight: number }[];
    }[];
}

/** Header and row positions must match to this many pixels. */
export const GEOMETRY_TOLERANCE_PX = 0.5;

type ShiftWindow = typeof window & { __skeletonShifts?: LayoutShiftReport };

/** Border boxes of the first match of each selector, in viewport pixels. */
export async function measureBoxes<Key extends string>(
    page: Page,
    selectors: Record<Key, string>
): Promise<Record<Key, Box>> {
    const boxes = await page.evaluate(
        (map) => {
            const result: Record<string, Box | null> = {};
            for (const [key, selector] of Object.entries(map)) {
                const rect = document
                    .querySelector(selector)
                    ?.getBoundingClientRect();
                result[key] = rect
                    ? {
                          top: rect.top,
                          left: rect.left,
                          width: rect.width,
                          height: rect.height,
                          bottom: rect.bottom,
                      }
                    : null;
            }
            return result;
        },
        selectors as Record<string, string>
    );

    for (const [key, box] of Object.entries(boxes)) {
        expect(
            box,
            `${key} (${selectors[key as Key]}) is rendered`
        ).not.toBeNull();
    }
    return boxes as Record<Key, Box>;
}

/**
 * Starts summing `layout-shift` entries from now on, with the nodes each
 * shift moved, until `readLayoutShifts`.
 */
export async function observeLayoutShifts(page: Page): Promise<void> {
    await page.evaluate(() => {
        const report: LayoutShiftReport = { score: 0, shifts: [] };
        (window as ShiftWindow).__skeletonShifts = report;
        const nodeLabel = (node: Node | null): string => {
            if (!(node instanceof Element)) return String(node?.nodeName);
            const testId = node.getAttribute('data-test-id');
            return [
                node.tagName.toLowerCase(),
                ...[...node.classList].map((name) => `.${name}`),
                testId ? `[data-test-id="${testId}"]` : '',
            ].join('');
        };
        new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as (PerformanceEntry & {
                value: number;
                sources?: {
                    node: Node | null;
                    previousRect: DOMRectReadOnly;
                    currentRect: DOMRectReadOnly;
                }[];
            })[]) {
                report.score += entry.value;
                report.shifts.push({
                    value: entry.value,
                    sources: (entry.sources ?? []).map((source) => ({
                        node: nodeLabel(source.node),
                        deltaY: source.currentRect.y - source.previousRect.y,
                        deltaHeight:
                            source.currentRect.height -
                            source.previousRect.height,
                    })),
                });
            }
        }).observe({ type: 'layout-shift', buffered: false });
    });
}

export async function readLayoutShifts(page: Page): Promise<LayoutShiftReport> {
    const report = await page.evaluate(
        () => (window as ShiftWindow).__skeletonShifts
    );
    if (!report) throw new Error('observeLayoutShifts was not called');
    return report;
}

/**
 * Resolves once the workspace content has not mutated for 300 ms (at most
 * 3 s), then after one more frame, so pending layout shifts are delivered.
 */
export async function waitForContentQuiet(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                const target =
                    document.querySelector('main.workspace-content') ??
                    document.documentElement;
                let quiet = 0;
                const finish = () => {
                    observer.disconnect();
                    clearTimeout(cap);
                    clearTimeout(quiet);
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => resolve())
                    );
                };
                const observer = new MutationObserver(() => {
                    clearTimeout(quiet);
                    quiet = window.setTimeout(finish, 300);
                });
                observer.observe(target, {
                    attributes: true,
                    characterData: true,
                    childList: true,
                    subtree: true,
                });
                quiet = window.setTimeout(finish, 300);
                const cap = window.setTimeout(finish, 3000);
            })
    );
}

/** `actual` within the geometry tolerance of `expected`, or a message
 * naming both boxes. */
export function expectSameEdge(
    label: string,
    actual: number,
    expected: number,
    evidence: unknown
): void {
    expect(
        Math.abs(actual - expected),
        `${label}: ${actual.toFixed(2)} vs skeleton ${expected.toFixed(2)}\n${JSON.stringify(evidence, null, 1)}`
    ).toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
}
