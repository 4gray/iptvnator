import type { Page } from '@playwright/test';

/**
 * Renderer-side probe for the performance journeys (J1 "Launch to usable").
 *
 * The probe is injected from the test side through `addInitScript` while the
 * journey gate (`journey-renderer-gate.cjs`) parks the window on
 * `about:blank`, so it runs before any renderer script and never touches
 * production code. It
 * counts DOM mutations, layout shifts and long tasks until the journey's
 * terminal condition and then emits one JSON blob under
 * `window.__iptvnatorJourneyProbe`.
 *
 * IPC invocations are not counted here: the bridge object exposed by
 * `contextBridge` is frozen, so the probe cannot wrap it. Instead the probe
 * fires one sentinel bridge call at the terminal moment; the main-process
 * capture (`journey-main-ipc-capture.ts`) counts the preload's renderer-API
 * trace events received before that sentinel. Renderer-to-main IPC is
 * ordered, so the count is exact regardless of clock skew.
 */
export const JOURNEY_PROBE_STATE_KEY = '__iptvnatorJourneyProbe';
export const JOURNEY_PROBE_SCHEMA_VERSION = 1;
export const JOURNEY_IPC_SENTINEL_ID = '__iptvnator-journey-sentinel__';
/** Bridge method used for the sentinel: a read-only lookup by id. */
export const JOURNEY_IPC_SENTINEL_METHOD = 'dbGetAppPlaylist';

export interface JourneyRendererProbeOptions {
    /** Selector for the element whose visibility ends the journey. */
    readonly cardSelector: string;
    readonly journey: string;
    /** Pathname fragment the terminal route must contain. */
    readonly routeFragment: string;
    readonly sentinelId: string;
    readonly sentinelMethod: string;
    /** Element id of the inline splash that must be gone at the end. */
    readonly splashId: string;
    readonly stateKey: string;
}

export interface JourneyRendererProbeCounters {
    domMutations: number;
    layoutShiftScore: number;
    longTasks: number;
}

export interface JourneyRendererProbeState {
    readonly capabilities: {
        changeDetectionTicks: string;
        layoutShift: boolean;
        longTask: boolean;
        observedTarget: 'document' | 'documentElement';
    };
    readonly counters: JourneyRendererProbeCounters;
    final: boolean;
    firstCardPaintEpochMs: number | null;
    readonly installed: {
        readonly bridgePresent: boolean;
        readonly documentElementPresent: boolean;
        readonly epochMs: number;
        readonly readyState: string;
        readonly scriptCount: number;
    };
    readonly invalidReasons: string[];
    readonly journey: string;
    readonly longTaskDurationsMs: number[];
    navigation: {
        readonly domContentLoadedEpochMs: number;
        readonly loadEventEndEpochMs: number;
    } | null;
    readonly schemaVersion: number;
    sentinel: {
        readonly epochMs: number | null;
        readonly status: 'bridge-missing' | 'failed' | 'not-sent' | 'sent';
    };
    terminal: {
        readonly cardTag: string;
        readonly cardTestId: string | null;
        readonly epochMs: number;
        readonly pathname: string;
    } | null;
}

/**
 * Page-side script. It must stay self-contained: Playwright serializes it
 * with `toString()`, so it may only use its argument and browser globals.
 */
export function journeyRendererProbeScript(
    options: JourneyRendererProbeOptions
): void {
    const target = globalThis as unknown as Record<string, unknown>;
    if (target[options.stateKey] !== undefined) {
        return;
    }
    const epoch = (): number => performance.timeOrigin + performance.now();
    const bridge = target['electron'] as Record<string, unknown> | undefined;
    const state: JourneyRendererProbeState = {
        capabilities: {
            changeDetectionTicks: 'pending',
            layoutShift: false,
            longTask: false,
            observedTarget: document.documentElement
                ? 'documentElement'
                : 'document',
        },
        counters: { domMutations: 0, layoutShiftScore: 0, longTasks: 0 },
        final: false,
        firstCardPaintEpochMs: null,
        installed: {
            bridgePresent: typeof bridge === 'object' && bridge !== null,
            documentElementPresent: document.documentElement !== null,
            epochMs: epoch(),
            readyState: document.readyState,
            scriptCount: document.scripts.length,
        },
        invalidReasons: [],
        journey: options.journey,
        longTaskDurationsMs: [],
        navigation: null,
        schemaVersion: 1,
        sentinel: { epochMs: null, status: 'not-sent' },
        terminal: null,
    };
    target[options.stateKey] = state;
    if (
        state.installed.scriptCount > 0 ||
        state.installed.readyState !== 'loading'
    ) {
        state.invalidReasons.push('probe-installed-after-document-start');
    }

    const acceptLayoutShift = (
        entries: readonly PerformanceEntry[],
        untilEpochMs: number
    ): void => {
        for (const entry of entries) {
            const shift = entry as PerformanceEntry & {
                hadRecentInput?: boolean;
                value?: number;
            };
            if (
                shift.hadRecentInput === true ||
                typeof shift.value !== 'number' ||
                performance.timeOrigin + shift.startTime > untilEpochMs
            ) {
                continue;
            }
            state.counters.layoutShiftScore += shift.value;
        }
    };
    const acceptLongTasks = (
        entries: readonly PerformanceEntry[],
        untilEpochMs: number
    ): void => {
        for (const entry of entries) {
            if (
                entry.duration <= 50 ||
                performance.timeOrigin + entry.startTime > untilEpochMs
            ) {
                continue;
            }
            state.counters.longTasks += 1;
            state.longTaskDurationsMs.push(entry.duration);
        }
    };
    // Entries delivered between the terminal batch and the post-paint
    // cutoff wait here so the cutoff applies to them as well.
    const pendingLayoutShifts: PerformanceEntry[] = [];
    const pendingLongTasks: PerformanceEntry[] = [];
    const observe = (
        type: string,
        accept: (entries: readonly PerformanceEntry[], until: number) => void,
        pending: PerformanceEntry[]
    ): PerformanceObserver | null => {
        try {
            const observer = new PerformanceObserver((list) => {
                if (state.final) return;
                if (state.terminal !== null) {
                    pending.push(...list.getEntries());
                    return;
                }
                accept(list.getEntries(), Number.POSITIVE_INFINITY);
            });
            observer.observe({ type, buffered: true });
            return observer;
        } catch {
            return null;
        }
    };
    const layoutShiftObserver = observe(
        'layout-shift',
        acceptLayoutShift,
        pendingLayoutShifts
    );
    const longTaskObserver = observe(
        'longtask',
        acceptLongTasks,
        pendingLongTasks
    );
    state.capabilities.layoutShift = layoutShiftObserver !== null;
    state.capabilities.longTask = longTaskObserver !== null;

    const finalize = (untilEpochMs: number): void => {
        if (layoutShiftObserver) {
            acceptLayoutShift(
                [...pendingLayoutShifts, ...layoutShiftObserver.takeRecords()],
                untilEpochMs
            );
            layoutShiftObserver.disconnect();
        }
        if (longTaskObserver) {
            acceptLongTasks(
                [...pendingLongTasks, ...longTaskObserver.takeRecords()],
                untilEpochMs
            );
            longTaskObserver.disconnect();
        }
        state.firstCardPaintEpochMs = untilEpochMs;
        state.final = true;
    };
    const sendSentinel = (): void => {
        const method = bridge?.[options.sentinelMethod];
        if (typeof method !== 'function') {
            state.sentinel = { epochMs: null, status: 'bridge-missing' };
            return;
        }
        try {
            const result: unknown = method.call(bridge, options.sentinelId);
            state.sentinel = { epochMs: epoch(), status: 'sent' };
            void Promise.resolve(result).catch(() => undefined);
        } catch {
            state.sentinel = { epochMs: null, status: 'failed' };
        }
    };
    const isVisible = (element: Element | null): element is HTMLElement =>
        element instanceof HTMLElement && element.getClientRects().length > 0;
    const readNavigation = (): JourneyRendererProbeState['navigation'] => {
        if (typeof performance.getEntriesByType !== 'function') {
            return null;
        }
        const entry = performance.getEntriesByType('navigation')[0] as
            PerformanceNavigationTiming | undefined;
        if (!entry || entry.loadEventEnd <= 0) {
            return null;
        }
        return {
            domContentLoadedEpochMs:
                performance.timeOrigin + entry.domContentLoadedEventEnd,
            loadEventEndEpochMs: performance.timeOrigin + entry.loadEventEnd,
        };
    };

    const mutationObserver = new MutationObserver((records) => {
        if (state.terminal !== null) return;
        state.counters.domMutations += records.length;
        if (
            !location.pathname.includes(options.routeFragment) ||
            document.getElementById(options.splashId) !== null
        ) {
            return;
        }
        const card = document.querySelector(options.cardSelector);
        if (!isVisible(card)) return;
        state.terminal = {
            cardTag: card.tagName.toLowerCase(),
            cardTestId: card.getAttribute('data-test-id'),
            epochMs: epoch(),
            pathname: location.pathname,
        };
        mutationObserver.disconnect();
        sendSentinel();
        state.navigation = readNavigation();
        if (state.navigation === null) {
            state.invalidReasons.push('load-event-not-finished-at-first-card');
        }
        const ng = target['ng'] as Record<string, unknown> | undefined;
        state.capabilities.changeDetectionTicks =
            typeof ng?.['ɵsetProfiler'] === 'function'
                ? 'hook-present-not-counted'
                : 'unavailable-ng-global-not-published';
        // A rAF callback runs before that frame's style, layout and paint,
        // so the cutoff is sampled in a timer queued from it: by then the
        // frame that paints the card has been committed, and the render
        // task's own long task and layout shift fall inside the cutoff.
        requestAnimationFrame(() => {
            setTimeout(() => finalize(epoch()), 0);
        });
    });
    mutationObserver.observe(document.documentElement ?? document, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
    });
}

export function createLaunchJourneyProbeOptions(): JourneyRendererProbeOptions {
    return {
        cardSelector:
            '[data-test-id="dashboard-recent-sources-rail-card"], app-playlist-item',
        journey: 'launch',
        routeFragment: '/workspace',
        sentinelId: JOURNEY_IPC_SENTINEL_ID,
        sentinelMethod: JOURNEY_IPC_SENTINEL_METHOD,
        splashId: 'initial-splash',
        stateKey: JOURNEY_PROBE_STATE_KEY,
    };
}

/**
 * Registers the probe on a page that is still parked on `about:blank` by the
 * journey gate, so it is guaranteed to run at the start of the next document.
 */
export async function installJourneyRendererProbe(
    page: Page,
    options: JourneyRendererProbeOptions
): Promise<void> {
    await page.addInitScript(journeyRendererProbeScript, options);
}

export async function waitForJourneyRendererProbe(
    page: Page,
    stateKey: string,
    timeoutMs: number
): Promise<JourneyRendererProbeState> {
    await page.waitForFunction(
        (key) =>
            (globalThis as unknown as Record<string, { final?: boolean }>)[key]
                ?.final === true,
        stateKey,
        { polling: 50, timeout: timeoutMs }
    );
    const state = await page.evaluate(
        (key) =>
            JSON.parse(
                JSON.stringify(
                    (globalThis as unknown as Record<string, unknown>)[key]
                )
            ) as unknown,
        stateKey
    );
    return assertJourneyRendererProbeState(state);
}

export function assertJourneyRendererProbeState(
    value: unknown
): JourneyRendererProbeState {
    const state = value as JourneyRendererProbeState | null;
    if (
        !state ||
        state.schemaVersion !== JOURNEY_PROBE_SCHEMA_VERSION ||
        state.final !== true ||
        state.terminal === null
    ) {
        throw new Error('journey-renderer-probe-incomplete');
    }
    if (state.invalidReasons.length > 0) {
        throw new Error(
            `journey-renderer-probe-invalid: ${state.invalidReasons.join(', ')}`
        );
    }
    if (state.sentinel.status !== 'sent') {
        throw new Error(
            `journey-renderer-probe-sentinel-${state.sentinel.status}`
        );
    }
    return state;
}
