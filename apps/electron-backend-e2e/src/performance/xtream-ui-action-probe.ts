import type { Page } from '@playwright/test';

import type { NumericDistribution } from './xtream-benchmark-contract';
import { summarizeNumbers } from './performance-statistics';
import { assertXtreamBackgroundRefreshActive } from './xtream-renderer-probe';

export const XTREAM_BACKGROUND_WINDOW = 'refresh-lifecycle';
export const XTREAM_UI_ACTION_ORDER = Object.freeze([
    'type-filter',
    'dashboard',
    'sources',
    'name-a-z',
    'global-search',
] as const);

export type XtreamUiActionKind = (typeof XTREAM_UI_ACTION_ORDER)[number];
export type XtreamUiActionCategory = 'action' | 'navigation' | 'search';

export interface XtreamUiActionSample {
    readonly activeAfter: true;
    readonly activeBefore: true;
    readonly category: XtreamUiActionCategory;
    readonly endEpochMs: number;
    readonly kind: XtreamUiActionKind;
    readonly latencyMs: number;
    readonly startEpochMs: number;
}

export interface XtreamUiActionSummary {
    readonly action: NumericDistribution;
    readonly navigation: NumericDistribution;
    readonly search: NumericDistribution;
}

export interface XtreamUiActionProbeResult extends XtreamUiActionSummary {
    readonly dashboardPaintVisibility: 'visible-without-overlay';
    readonly samples: readonly XtreamUiActionSample[];
}

export interface XtreamUiActionProbeOptions {
    readonly operationId: string;
    readonly playlistId: string;
    readonly searchTerm: string;
}

export async function runXtreamBackgroundUiActions(
    page: Page,
    options: XtreamUiActionProbeOptions
): Promise<XtreamUiActionProbeResult> {
    const samples: XtreamUiActionSample[] = [];
    samples.push(
        await measureAction(
            page,
            options,
            'type-filter',
            'action',
            async () => {
                const start = await clickTextOption(
                    page,
                    'app-workspace-sources-filters-panel .option-row',
                    '.option-label',
                    'Xtream'
                );
                await page.waitForFunction(() => {
                    const rows = Array.from(
                        document.querySelectorAll(
                            'app-workspace-sources-filters-panel .option-row.selected'
                        )
                    );
                    return rows.some(
                        (row) =>
                            row
                                .querySelector('.option-label')
                                ?.textContent?.trim() === 'Xtream'
                    );
                });
                return start;
            }
        )
    );
    samples.push(
        await measureAction(
            page,
            options,
            'dashboard',
            'navigation',
            async () => {
                const start = await clickSelector(
                    page,
                    'a.brand[href$="/workspace/dashboard"]'
                );
                await page.waitForFunction(() => {
                    const overlay = document.querySelector(
                        '.workspace-loading-overlay'
                    );
                    const dashboard = document.querySelector(
                        'lib-workspace-dashboard-rails'
                    );
                    return (
                        location.pathname.endsWith('/workspace/dashboard') &&
                        visible(dashboard) &&
                        !visible(overlay)
                    );
                    function visible(element: Element | null): boolean {
                        return (
                            element instanceof HTMLElement &&
                            element.getClientRects().length > 0
                        );
                    }
                });
                return start;
            }
        )
    );
    samples.push(
        await measureAction(
            page,
            options,
            'sources',
            'navigation',
            async () => {
                const start = await clickSelector(
                    page,
                    'a[href$="/workspace/sources"]'
                );
                await page.waitForFunction(
                    () =>
                        location.pathname.endsWith('/workspace/sources') &&
                        document.querySelector('app-workspace-sources') !== null
                );
                return start;
            }
        )
    );
    samples.push(await measureNameSort(page, options));
    samples.push(
        await measureAction(
            page,
            options,
            'global-search',
            'search',
            async () => {
                const start = await setSearchInput(page, options.searchTerm);
                await page.waitForFunction(
                    ({ searchTerm }) => {
                        const input = document.querySelector(
                            'app-workspace-shell-header .search-field input[type="search"]'
                        );
                        const normalizedSearchTerm = searchTerm
                            .trim()
                            .toLowerCase();
                        const searchParams = new URLSearchParams(
                            location.search
                        );
                        const resultRows = Array.from(
                            document.querySelectorAll(
                                'app-workspace-sources app-playlist-item'
                            )
                        );
                        const resultPainted =
                            resultRows.length > 0
                                ? resultRows.every((row) =>
                                      (
                                          row.querySelector('.playlist-title')
                                              ?.textContent ?? ''
                                      )
                                          .trim()
                                          .toLowerCase()
                                          .includes(normalizedSearchTerm)
                                  )
                                : visible(
                                      document.querySelector(
                                          'app-workspace-sources .no-results-state'
                                      )
                                  );
                        return (
                            input instanceof HTMLInputElement &&
                            input.value === searchTerm &&
                            searchParams.get('q') === searchTerm.trim() &&
                            resultPainted
                        );
                        function visible(element: Element | null): boolean {
                            return (
                                element instanceof HTMLElement &&
                                element.getClientRects().length > 0
                            );
                        }
                    },
                    { searchTerm: options.searchTerm }
                );
                return start;
            }
        )
    );
    assertExactActionOrder(samples);
    const summary = summarizeXtreamUiActionSamples(samples);
    return Object.freeze({
        ...summary,
        dashboardPaintVisibility: 'visible-without-overlay',
        samples: Object.freeze([...samples]),
    });
}

export function summarizeXtreamUiActionSamples(
    samples: readonly Pick<
        XtreamUiActionSample,
        'category' | 'endEpochMs' | 'kind' | 'latencyMs' | 'startEpochMs'
    >[]
): XtreamUiActionSummary {
    const values = (category: XtreamUiActionCategory): readonly number[] =>
        samples
            .filter((sample) => sample.category === category)
            .map((sample) => sample.latencyMs);
    return Object.freeze({
        action: summarizeNumbers(values('action')),
        navigation: summarizeNumbers(values('navigation')),
        search: summarizeNumbers(values('search')),
    });
}

async function measureAction(
    page: Page,
    options: Pick<XtreamUiActionProbeOptions, 'operationId' | 'playlistId'>,
    kind: XtreamUiActionKind,
    category: XtreamUiActionCategory,
    triggerAndWait: () => Promise<number>
): Promise<XtreamUiActionSample> {
    await assertXtreamBackgroundRefreshActive(page, options);
    const activeBefore = true as const;
    const startEpochMs = await triggerAndWait();
    const endEpochMs = await waitForTwoRenderedFrames(page);
    await assertXtreamBackgroundRefreshActive(page, options);
    const activeAfter = true as const;
    if (
        !Number.isFinite(startEpochMs) ||
        !Number.isFinite(endEpochMs) ||
        endEpochMs < startEpochMs
    ) {
        throw new Error(`xtream-ui-action-invalid:${kind}`);
    }
    return Object.freeze({
        activeAfter,
        activeBefore,
        category,
        endEpochMs,
        kind,
        latencyMs: endEpochMs - startEpochMs,
        startEpochMs,
    });
}

async function measureNameSort(
    page: Page,
    options: Pick<XtreamUiActionProbeOptions, 'operationId' | 'playlistId'>
): Promise<XtreamUiActionSample> {
    return measureAction(page, options, 'name-a-z', 'action', async () => {
        const start = await clickSelector(
            page,
            'app-workspace-sources .sort-trigger'
        );
        await page
            .getByRole('menuitem', { name: 'Name (A-Z)' })
            .waitFor({ state: 'visible' });
        await clickTextOption(page, '[role="menuitem"]', 'span', 'Name (A-Z)');
        await page.waitForFunction(
            () =>
                document
                    .querySelector('app-workspace-sources .sort-trigger__label')
                    ?.textContent?.trim() === 'Name (A-Z)'
        );
        return start;
    });
}

async function clickSelector(page: Page, selector: string): Promise<number> {
    return page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) {
            throw new Error('xtream-ui-action-target-unavailable');
        }
        const startedAt = performance.timeOrigin + performance.now();
        element.click();
        return startedAt;
    }, selector);
}

async function clickTextOption(
    page: Page,
    rowSelector: string,
    labelSelector: string,
    expectedLabel: string
): Promise<number> {
    return page.evaluate(
        ({ expectedLabel, labelSelector, rowSelector }) => {
            const match = Array.from(
                document.querySelectorAll(rowSelector)
            ).find(
                (element) =>
                    element
                        .querySelector(labelSelector)
                        ?.textContent?.trim() === expectedLabel
            );
            if (!(match instanceof HTMLElement)) {
                throw new Error('xtream-ui-action-option-unavailable');
            }
            const startedAt = performance.timeOrigin + performance.now();
            match.click();
            return startedAt;
        },
        { expectedLabel, labelSelector, rowSelector }
    );
}

async function setSearchInput(page: Page, value: string): Promise<number> {
    return page.evaluate((value) => {
        const input = document.querySelector(
            'app-workspace-shell-header .search-field input[type="search"]'
        );
        if (!(input instanceof HTMLInputElement) || input.disabled) {
            throw new Error('xtream-ui-search-unavailable');
        }
        const startedAt = performance.timeOrigin + performance.now();
        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return startedAt;
    }, value);
}

async function waitForTwoRenderedFrames(page: Page): Promise<number> {
    return page.evaluate(
        () =>
            new Promise<number>((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        resolve(performance.timeOrigin + performance.now());
                    });
                });
            })
    );
}

function assertExactActionOrder(
    samples: readonly XtreamUiActionSample[]
): void {
    if (
        samples.length !== XTREAM_UI_ACTION_ORDER.length ||
        samples.some(
            (sample, index) => sample.kind !== XTREAM_UI_ACTION_ORDER[index]
        )
    ) {
        throw new Error(
            `xtream-ui-action-order-invalid:${XTREAM_BACKGROUND_WINDOW}`
        );
    }
}
