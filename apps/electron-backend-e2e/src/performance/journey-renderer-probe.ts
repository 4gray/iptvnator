import type { Page } from '@playwright/test';

/**
 * Renderer-side probe for the performance journeys.
 *
 * J1 "Launch to usable" starts at document start: the probe is injected from
 * the test side through `addInitScript` while the journey gate
 * (`journey-renderer-gate.cjs`) parks the window on `about:blank`, so it runs
 * before any renderer script and never touches production code. Journeys that
 * start with a click (J2 "Open a source") pass `startClick`: the probe is
 * evaluated in the loaded document, arms a capture-phase `click` listener on
 * `window` (which runs before any listener of the app) and starts counting at
 * the first click inside `startClick.selector`. It counts DOM mutations,
 * layout shifts and long tasks until the journey's terminal condition and
 * then emits one JSON blob under `options.stateKey`. With `options.settle`
 * (J1) it keeps summing layout shifts after the first card until the page
 * has settled, for shifts such as collapsing skeletons that land later, and
 * with `options.idle` it then counts what the untouched page does for a
 * fixed window. With `options.media` (J3 "Playback") the terminal condition
 * is a media event (`playing`) on an element matching `cardSelector` instead
 * of that element becoming visible.
 *
 * Change-detection ticks are read from the counter that only the
 * `electron-performance` build of `apps/web` installs
 * (`apps/web/src/environments/change-detection-tick-counter.ts`) under
 * `options.cdTickCounterKey`. The probe takes differences of that running
 * total at the journey's boundaries; a build without the counter fails the
 * iteration in the journey record.
 *
 * IPC invocations are not counted here: the bridge object exposed by
 * `contextBridge` is frozen, so the probe cannot wrap it. Instead the probe
 * fires one sentinel bridge call at the terminal moment (and, for a click
 * start, one start sentinel before the app sees the click); the main-process
 * capture (`journey-main-ipc-capture.ts`) counts the preload's renderer-API
 * trace events received between the two. Renderer-to-main IPC is ordered, so
 * the count is exact regardless of clock skew.
 */
export const JOURNEY_PROBE_STATE_KEY = '__iptvnatorJourneyProbe';
export const JOURNEY_PROBE_SCHEMA_VERSION = 1;
export const JOURNEY_IPC_SENTINEL_ID = '__iptvnator-journey-sentinel__';
export const JOURNEY_OPEN_SOURCE_PROBE_STATE_KEY =
    '__iptvnatorJourneyOpenSourceProbe';
export const JOURNEY_OPEN_SOURCE_START_SENTINEL_ID =
    '__iptvnator-journey-open-source-start__';
export const JOURNEY_OPEN_SOURCE_END_SENTINEL_ID =
    '__iptvnator-journey-open-source-end__';
export const JOURNEY_PLAYBACK_PROBE_STATE_KEY =
    '__iptvnatorJourneyPlaybackProbe';
export const JOURNEY_PLAYBACK_START_SENTINEL_ID =
    '__iptvnator-journey-playback-start__';
export const JOURNEY_PLAYBACK_END_SENTINEL_ID =
    '__iptvnator-journey-playback-end__';
/** A live channel row in the Xtream live layout. */
export const JOURNEY_PLAYBACK_START_SELECTOR =
    'app-live-stream-layout [data-test-id="channel-item"]';
/** The HTML5 player's video element inside the web player view. */
export const JOURNEY_PLAYBACK_VIDEO_SELECTOR = 'app-web-player-view video';
/** The Xtream portal card on the dashboard or its row on /workspace/sources. */
export const JOURNEY_OPEN_SOURCE_START_SELECTOR =
    '[data-test-id="dashboard-recent-sources-rail-card"], app-playlist-item';
/**
 * Bridge method used for the sentinels. The preload emits the trace event
 * before it forwards the call, and `SOURCE_HEALTH_CANCEL` only looks the id
 * up in an in-memory map in the main process, so a marker call never
 * reaches the database worker, the disk or the network and cannot queue
 * ahead of the work being measured.
 */
export const JOURNEY_IPC_SENTINEL_METHOD = 'cancelSourceProbe';

export interface JourneyRendererProbeStartClick {
    /** The journey starts at the first click inside this selector. */
    readonly selector: string;
    /** Id of the start sentinel sent before the app handles the click. */
    readonly sentinelId: string;
}

/**
 * J1's settle window after the first card: it ends once nothing under
 * `rootSelector` has mutated for `quietMs`, or `capMs` after the first-card
 * cutoff, whichever comes first. See docs/architecture/performance-journeys.md.
 */
export interface JourneyRendererProbeSettleOptions {
    readonly capMs: number;
    readonly quietMs: number;
    /** Falls back to the document element when nothing matches. */
    readonly rootSelector: string;
}

/**
 * A journey that ends on a media event rather than on visibility (J3). The
 * first `endEvent` after the start on an element matching `cardSelector`
 * is the terminal moment; the first of each `phaseEvents` after the start
 * is recorded under `media.phases`.
 */
export interface JourneyRendererProbeMediaOptions {
    readonly endEvent: string;
    readonly phaseEvents: readonly string[];
}

export const JOURNEY_SETTLE_QUIET_MS = 500;
export const JOURNEY_SETTLE_CAP_MS = 3_000;
/** The workspace shell's content pane; the rail and header stay outside. */
export const JOURNEY_SETTLE_ROOT_SELECTOR = 'main.workspace-content';

/**
 * Global the electron-performance build's tick counter lives under; the
 * build-config spec checks it against
 * `CHANGE_DETECTION_TICK_COUNTER_KEY` in apps/web.
 */
export const JOURNEY_CD_TICK_COUNTER_KEY = '__iptvnatorCdTicks';

/**
 * J1's idle window: it opens at the settle point and counts what the page
 * does, with no input, for `durationMs`. See performance-journeys.md.
 */
export interface JourneyRendererProbeIdleOptions {
    readonly durationMs: number;
}

export const JOURNEY_IDLE_WINDOW_MS = 30_000;

export interface JourneyRendererProbeOptions {
    /** Selector for the element whose visibility ends the journey. */
    readonly cardSelector: string;
    /** Global holding the build's change-detection tick counter. */
    readonly cdTickCounterKey: string;
    /** Further selectors that must each match a visible element as well. */
    readonly companionSelectors?: readonly string[];
    /** Absent: no idle window. Needs `settle`, which it follows. */
    readonly idle?: JourneyRendererProbeIdleOptions;
    readonly journey: string;
    /** Absent: the journey ends when `cardSelector` becomes visible. */
    readonly media?: JourneyRendererProbeMediaOptions;
    /** Pathname fragment the terminal route must contain. */
    readonly routeFragment: string;
    readonly sentinelId: string;
    /** Absent: no settle window, the probe ends at the first-card cutoff. */
    readonly settle?: JourneyRendererProbeSettleOptions;
    readonly sentinelMethod: string;
    /** Element id of the inline splash that must be gone at the end. */
    readonly splashId: string;
    /** Absent: the journey starts at document start (J1). */
    readonly startClick?: JourneyRendererProbeStartClick;
    readonly stateKey: string;
}

export interface JourneyRendererProbeCounters {
    /**
     * `ApplicationRef` ticks from the journey's start until the terminal
     * batch. Null when the build has no tick counter.
     */
    changeDetectionTicks: number | null;
    domMutations: number;
    /** Shifts with `hadRecentInput === false` (the CLS definition). */
    layoutShiftScore: number;
    /**
     * The same filter from the journey's start until the settle point. Zero
     * while `settle.status` is `pending` or `disabled`.
     */
    layoutShiftScoreSettled: number;
    longTasks: number;
    /**
     * Shifts with `hadRecentInput === true`. Zero for J1, which has no
     * input; a click-started journey runs inside the 500 ms input window.
     */
    recentInputLayoutShiftScore: number;
}

export interface JourneyRendererProbeLateShift {
    /** Entry start minus the first-card terminal epoch. */
    readonly afterFirstCardMs: number;
    /** `tag.class[data-test-id]` and the vertical move of each source. */
    readonly sources: readonly {
        readonly deltaHeight: number;
        readonly deltaY: number;
        readonly node: string;
    }[];
    readonly value: number;
}

export interface JourneyRendererProbeState {
    readonly capabilities: {
        changeDetectionTicks:
            'counted' | 'pending' | 'unavailable-counter-missing';
        layoutShift: boolean;
        longTask: boolean;
        observedTarget: 'document' | 'documentElement';
    };
    readonly counters: JourneyRendererProbeCounters;
    final: boolean;
    firstCardPaintEpochMs: number | null;
    /** The idle window after the settle point (J1). */
    idle: {
        /** Mutation records in the whole document during the window. */
        domMutations: number;
        endEpochMs: number | null;
        startEpochMs: number | null;
        status: 'disabled' | 'done' | 'pending';
        /** Ticks during the window; null without a tick counter. */
        ticks: number | null;
    };
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
    /** Media-terminated journeys only; null otherwise. */
    readonly media: {
        /** At the terminal event, the element it fired on. */
        element: {
            readonly currentSrcScheme: string;
            readonly currentTime: number;
            readonly paused: boolean;
            readonly readyState: number;
            readonly videoHeight: number;
            readonly videoWidth: number;
        } | null;
        /** Event type → epoch of its first occurrence after the start. */
        readonly phases: Record<string, number>;
    } | null;
    navigation: {
        readonly domContentLoadedEpochMs: number;
        readonly loadEventEndEpochMs: number;
    } | null;
    /** Click-started journeys: activity before the click, for settling. */
    readonly preStart: {
        domMutations: number;
        lastMutationEpochMs: number | null;
    };
    readonly schemaVersion: number;
    sentinel: {
        readonly epochMs: number | null;
        readonly status: 'bridge-missing' | 'failed' | 'not-sent' | 'sent';
    };
    /** `final` freezes the first-card counters; the settle window ends later. */
    settle: {
        /** Mutation records under the settle root after the cutoff. */
        domMutations: number;
        epochMs: number | null;
        lastMutationEpochMs: number | null;
        /**
         * Counted shifts after the first-card cutoff, at most 20, with the
         * nodes that moved, so a late shift can be traced to its component.
         */
        lateShifts: JourneyRendererProbeLateShift[];
        observedTarget: 'documentElement' | 'root' | null;
        status: 'cap' | 'disabled' | 'pending' | 'quiet';
    };
    start: {
        /** `min(event.timeStamp, listener time)` as epoch milliseconds. */
        readonly epochMs: number;
        readonly listenerEpochMs: number;
        readonly pathname: string;
        readonly sentinelStatus: 'bridge-missing' | 'failed' | 'sent';
        readonly targetTag: string;
        readonly targetTestId: string | null;
    } | null;
    terminal: {
        readonly cardCount: number;
        readonly cardTag: string;
        readonly cardTestId: string | null;
        readonly companionCounts: readonly number[];
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
    const startClick = options.startClick ?? null;
    const mediaOptions = options.media ?? null;
    const settleOptions = options.settle ?? null;
    const idleOptions = options.idle ?? null;
    const companionSelectors = options.companionSelectors ?? [];
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
        counters: {
            changeDetectionTicks: null,
            domMutations: 0,
            layoutShiftScore: 0,
            layoutShiftScoreSettled: 0,
            longTasks: 0,
            recentInputLayoutShiftScore: 0,
        },
        final: false,
        firstCardPaintEpochMs: null,
        idle: {
            domMutations: 0,
            endEpochMs: null,
            startEpochMs: null,
            status: idleOptions === null ? 'disabled' : 'pending',
            ticks: null,
        },
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
        media: mediaOptions === null ? null : { element: null, phases: {} },
        navigation: null,
        preStart: { domMutations: 0, lastMutationEpochMs: null },
        schemaVersion: 1,
        sentinel: { epochMs: null, status: 'not-sent' },
        settle: {
            domMutations: 0,
            epochMs: null,
            lastMutationEpochMs: null,
            lateShifts: [],
            observedTarget: null,
            status: settleOptions === null ? 'disabled' : 'pending',
        },
        start: null,
        terminal: null,
    };
    target[options.stateKey] = state;
    // The build installs its counter while main.js evaluates, before
    // Angular bootstraps, so J1 starts from zero; a click start reads the
    // running total at the click.
    const readTicks = (): number | null => {
        const counter = target[options.cdTickCounterKey] as
            { count?: unknown } | undefined;
        return typeof counter?.count === 'number' ? counter.count : null;
    };
    let ticksAtStart: number | null = startClick === null ? 0 : null;
    if (
        startClick === null &&
        (state.installed.scriptCount > 0 ||
            state.installed.readyState !== 'loading')
    ) {
        state.invalidReasons.push('probe-installed-after-document-start');
    }
    if (mediaOptions !== null && startClick === null) {
        state.invalidReasons.push('media-terminal-needs-start-click');
    }
    // Performance entries before the journey's start belong to an earlier
    // journey (buffered entries included) and are dropped.
    let fromEpochMs =
        startClick === null
            ? Number.NEGATIVE_INFINITY
            : Number.POSITIVE_INFINITY;
    const inWindow = (entry: PerformanceEntry, untilEpochMs: number) => {
        const entryEpochMs = performance.timeOrigin + entry.startTime;
        return entryEpochMs >= fromEpochMs && entryEpochMs <= untilEpochMs;
    };
    // A task overlaps the window when it ends after the start. The main
    // thread runs one task at a time, so the only task that overlaps the
    // click is the one that dispatches it, which began before the event's
    // timestamp and must still count.
    const overlapsWindow = (entry: PerformanceEntry, untilEpochMs: number) => {
        const entryEpochMs = performance.timeOrigin + entry.startTime;
        return (
            entryEpochMs + entry.duration >= fromEpochMs &&
            entryEpochMs <= untilEpochMs
        );
    };

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
                typeof shift.value !== 'number' ||
                !inWindow(entry, untilEpochMs)
            ) {
                continue;
            }
            if (shift.hadRecentInput === true) {
                state.counters.recentInputLayoutShiftScore += shift.value;
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
            if (entry.duration <= 50 || !overlapsWindow(entry, untilEpochMs)) {
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
    // Every layout shift delivered until the settle point, kept apart from
    // the first-card path so that counter stays exactly as it was; the
    // settle bound is applied once it is known.
    const settleLayoutShifts: PerformanceEntry[] = [];
    const collectSettleShifts = (entries: readonly PerformanceEntry[]) => {
        if (state.settle.status === 'pending') {
            settleLayoutShifts.push(...entries);
        }
    };
    const observe = (
        type: string,
        accept: (entries: readonly PerformanceEntry[], until: number) => void,
        pending: PerformanceEntry[],
        collect: ((entries: readonly PerformanceEntry[]) => void) | null
    ): PerformanceObserver | null => {
        try {
            const observer = new PerformanceObserver((list) => {
                collect?.(list.getEntries());
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
        pendingLayoutShifts,
        collectSettleShifts
    );
    const longTaskObserver = observe(
        'longtask',
        acceptLongTasks,
        pendingLongTasks,
        null
    );
    state.capabilities.layoutShift = layoutShiftObserver !== null;
    state.capabilities.longTask = longTaskObserver !== null;

    const endSettle = (status: 'cap' | 'quiet', untilEpochMs: number) => {
        if (layoutShiftObserver) {
            collectSettleShifts(layoutShiftObserver.takeRecords());
            layoutShiftObserver.disconnect();
        }
        let score = 0;
        for (const entry of settleLayoutShifts) {
            const shift = entry as PerformanceEntry & {
                hadRecentInput?: boolean;
                sources?: readonly LateShiftSource[];
                value?: number;
            };
            if (
                typeof shift.value !== 'number' ||
                shift.hadRecentInput === true ||
                !inWindow(entry, untilEpochMs)
            ) {
                continue;
            }
            score += shift.value;
            const entryEpochMs = performance.timeOrigin + entry.startTime;
            if (
                entryEpochMs > (state.firstCardPaintEpochMs ?? untilEpochMs) &&
                state.settle.lateShifts.length < 20
            ) {
                state.settle.lateShifts.push({
                    afterFirstCardMs:
                        entryEpochMs - (state.terminal?.epochMs ?? 0),
                    sources: (shift.sources ?? []).map(describeSource),
                    value: shift.value,
                });
            }
        }
        state.counters.layoutShiftScoreSettled = score;
        state.settle.epochMs = untilEpochMs;
        state.settle.status = status;
        if (idleOptions !== null) startIdle(idleOptions);
    };
    // Opens when the settle window closes, so startup work that is still
    // landing does not count as idle work. Nothing touches the page.
    const startIdle = (idle: JourneyRendererProbeIdleOptions): void => {
        const idleObserver = new MutationObserver((records) => {
            state.idle.domMutations += records.length;
        });
        idleObserver.observe(document.documentElement ?? document, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
        });
        const startTicks = readTicks();
        state.idle.startEpochMs = epoch();
        setTimeout(() => {
            const endTicks = readTicks();
            state.idle.domMutations += idleObserver.takeRecords().length;
            idleObserver.disconnect();
            state.idle.endEpochMs = epoch();
            state.idle.ticks =
                startTicks === null || endTicks === null
                    ? null
                    : endTicks - startTicks;
            state.idle.status = 'done';
        }, idle.durationMs);
    };
    type LateShiftSource = {
        currentRect?: { height: number; y: number };
        node?: Node | null;
        previousRect?: { height: number; y: number };
    };
    const describeSource = (source: LateShiftSource) => {
        const node = source.node;
        let label = node ? node.nodeName.toLowerCase() : 'unknown';
        if (node instanceof Element) {
            const className = node.classList.item(0);
            // Component hosts such as `lib-dashboard-rail` carry the test
            // id on their first child.
            const testId =
                node.getAttribute('data-test-id') ??
                node.firstElementChild?.getAttribute('data-test-id');
            label += className ? `.${className}` : '';
            label += testId ? `[data-test-id="${testId}"]` : '';
        }
        const before = source.previousRect;
        const after = source.currentRect;
        return {
            deltaHeight: before && after ? after.height - before.height : 0,
            deltaY: before && after ? after.y - before.y : 0,
            node: label,
        };
    };
    // Starts at the first-card cutoff. Every mutation record under the root
    // restarts the quiet timer; the cap timer never moves. A timer can run
    // late on a busy main thread, so the settle point is the deadline it was
    // scheduled for, never the moment it ran: a late timer must not let
    // shifts after the deadline into the counter.
    const startSettle = (settle: JourneyRendererProbeSettleOptions) => {
        const root = document.querySelector(settle.rootSelector);
        state.settle.observedTarget =
            root === null ? 'documentElement' : 'root';
        let quietTimer: ReturnType<typeof setTimeout> | undefined;
        let quietDeadlineEpochMs = Number.POSITIVE_INFINITY;
        const capDeadlineEpochMs = epoch() + settle.capMs;
        const capTimer = setTimeout(() => end('cap'), settle.capMs);
        const settleObserver = new MutationObserver((records) => {
            if (state.settle.status !== 'pending') return;
            state.settle.domMutations += records.length;
            state.settle.lastMutationEpochMs = epoch();
            armQuiet();
        });
        const end = (status: 'cap' | 'quiet'): void => {
            if (state.settle.status !== 'pending') return;
            clearTimeout(quietTimer);
            clearTimeout(capTimer);
            state.settle.domMutations += settleObserver.takeRecords().length;
            settleObserver.disconnect();
            const deadline =
                status === 'cap' ? capDeadlineEpochMs : quietDeadlineEpochMs;
            endSettle(status, Math.min(epoch(), deadline));
        };
        const armQuiet = (): void => {
            clearTimeout(quietTimer);
            quietDeadlineEpochMs = epoch() + settle.quietMs;
            quietTimer = setTimeout(() => end('quiet'), settle.quietMs);
        };
        settleObserver.observe(root ?? document.documentElement ?? document, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
        });
        armQuiet();
    };

    // A media journey's counters stop at the terminal event itself (the
    // task that dispatched it still overlaps and counts); the others count
    // until the post-paint cutoff.
    const finalize = (untilEpochMs: number): void => {
        const countUntilEpochMs =
            mediaOptions !== null && state.terminal !== null
                ? state.terminal.epochMs
                : untilEpochMs;
        if (layoutShiftObserver) {
            const records = layoutShiftObserver.takeRecords();
            collectSettleShifts(records);
            acceptLayoutShift(
                [...pendingLayoutShifts, ...records],
                countUntilEpochMs
            );
            if (settleOptions === null) layoutShiftObserver.disconnect();
        }
        if (longTaskObserver) {
            acceptLongTasks(
                [...pendingLongTasks, ...longTaskObserver.takeRecords()],
                countUntilEpochMs
            );
            longTaskObserver.disconnect();
        }
        state.firstCardPaintEpochMs = untilEpochMs;
        state.final = true;
        if (settleOptions !== null) startSettle(settleOptions);
    };
    const callSentinel = (id: string): 'bridge-missing' | 'failed' | 'sent' => {
        const method = bridge?.[options.sentinelMethod];
        if (typeof method !== 'function') {
            return 'bridge-missing';
        }
        try {
            const result: unknown = method.call(bridge, id);
            void Promise.resolve(result).catch(() => undefined);
            return 'sent';
        } catch {
            return 'failed';
        }
    };
    const sendSentinel = (): void => {
        const status = callSentinel(options.sentinelId);
        state.sentinel = {
            epochMs: status === 'sent' ? epoch() : null,
            status,
        };
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

    const countPreStart = (count: number): void => {
        if (count === 0) return;
        state.preStart.domMutations += count;
        state.preStart.lastMutationEpochMs = epoch();
    };
    const mutationObserver = new MutationObserver((records) => {
        if (state.terminal !== null) return;
        if (startClick !== null && state.start === null) {
            countPreStart(records.length);
            return;
        }
        state.counters.domMutations += records.length;
        if (
            mediaOptions !== null ||
            !location.pathname.includes(options.routeFragment) ||
            document.getElementById(options.splashId) !== null
        ) {
            return;
        }
        const card = document.querySelector(options.cardSelector);
        if (!isVisible(card)) return;
        const companionCounts: number[] = [];
        for (const selector of companionSelectors) {
            if (!isVisible(document.querySelector(selector))) return;
            companionCounts.push(document.querySelectorAll(selector).length);
        }
        end(card, companionCounts, epoch());
    });
    const end = (
        card: Element,
        companionCounts: number[],
        epochMs: number
    ): void => {
        state.terminal = {
            cardCount: document.querySelectorAll(options.cardSelector).length,
            cardTag: card.tagName.toLowerCase(),
            cardTestId: card.getAttribute('data-test-id'),
            companionCounts,
            epochMs,
            pathname: location.pathname,
        };
        mutationObserver.disconnect();
        sendSentinel();
        if (startClick === null) {
            state.navigation = readNavigation();
            if (state.navigation === null) {
                state.invalidReasons.push(
                    'load-event-not-finished-at-first-card'
                );
            }
        }
        // A tick that rendered the card ran before this microtask (or,
        // for a media terminal, before the event's task), so it is
        // included; no other tick can run in between.
        const ticks = readTicks();
        if (ticks === null || ticksAtStart === null) {
            state.capabilities.changeDetectionTicks =
                'unavailable-counter-missing';
        } else {
            state.capabilities.changeDetectionTicks = 'counted';
            state.counters.changeDetectionTicks = ticks - ticksAtStart;
        }
        // A rAF callback runs before that frame's style, layout and paint,
        // so the cutoff is sampled in a timer queued from it: by then the
        // frame that paints the card has been committed, and the render
        // task's own long task and layout shift fall inside the cutoff.
        requestAnimationFrame(() => {
            setTimeout(() => finalize(epoch()), 0);
        });
    };
    mutationObserver.observe(document.documentElement ?? document, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
    });
    if (startClick === null) return;

    // Capture phase on window runs before every listener of the app, so the
    // start sentinel precedes any bridge call the click causes and the
    // mutation count starts before the app touches the DOM.
    const onClick = (event: Event): void => {
        if (state.start !== null) return;
        const origin =
            event.target instanceof Element
                ? event.target.closest(startClick.selector)
                : null;
        if (origin === null) return;
        const listenerEpochMs = epoch();
        const eventEpochMs = performance.timeOrigin + event.timeStamp;
        countPreStart(mutationObserver.takeRecords().length);
        // Capture phase: no tick for this click has run yet.
        ticksAtStart = readTicks();
        const sentinelStatus = callSentinel(startClick.sentinelId);
        state.start = {
            epochMs:
                Number.isFinite(eventEpochMs) && eventEpochMs <= listenerEpochMs
                    ? eventEpochMs
                    : listenerEpochMs,
            listenerEpochMs,
            pathname: location.pathname,
            sentinelStatus,
            targetTag: origin.tagName.toLowerCase(),
            targetTestId: origin.getAttribute('data-test-id'),
        };
        fromEpochMs = state.start.epochMs;
        window.removeEventListener('click', onClick, true);
    };
    window.addEventListener('click', onClick, true);
    if (mediaOptions === null) return;

    // Media events do not bubble, but a capture listener on window still
    // sees them before any listener of the app. Mutations up to the event
    // are taken synchronously, so the count ends exactly at the event.
    const onMediaEvent = (event: Event): void => {
        const element = event.target;
        if (
            state.start === null ||
            state.terminal !== null ||
            state.media === null ||
            !(element instanceof HTMLMediaElement) ||
            !element.matches(options.cardSelector)
        ) {
            return;
        }
        const at = epoch();
        state.media.phases[event.type] ??= at;
        if (event.type !== mediaOptions.endEvent) return;
        state.counters.domMutations += mutationObserver.takeRecords().length;
        const video = element as HTMLMediaElement & {
            videoHeight?: number;
            videoWidth?: number;
        };
        state.media.element = {
            currentSrcScheme: element.currentSrc.split(':')[0] ?? '',
            currentTime: element.currentTime,
            paused: element.paused,
            readyState: element.readyState,
            videoHeight: video.videoHeight ?? 0,
            videoWidth: video.videoWidth ?? 0,
        };
        end(element, [], at);
    };
    for (const type of [mediaOptions.endEvent, ...mediaOptions.phaseEvents]) {
        window.addEventListener(type, onMediaEvent, true);
    }
}

/**
 * Options for J1. `idleWindowMs` adds the idle window after the settle point;
 * journeys that continue from the launch (J2) pass null so their click does
 * not wait for it.
 */
export function createLaunchJourneyProbeOptions(
    idleWindowMs: number | null
): JourneyRendererProbeOptions {
    return {
        cardSelector:
            '[data-test-id="dashboard-recent-sources-rail-card"], app-playlist-item',
        cdTickCounterKey: JOURNEY_CD_TICK_COUNTER_KEY,
        ...(idleWindowMs === null
            ? {}
            : { idle: { durationMs: idleWindowMs } }),
        journey: 'launch',
        routeFragment: '/workspace',
        sentinelId: JOURNEY_IPC_SENTINEL_ID,
        sentinelMethod: JOURNEY_IPC_SENTINEL_METHOD,
        settle: {
            capMs: JOURNEY_SETTLE_CAP_MS,
            quietMs: JOURNEY_SETTLE_QUIET_MS,
            rootSelector: JOURNEY_SETTLE_ROOT_SELECTOR,
        },
        splashId: 'initial-splash',
        stateKey: JOURNEY_PROBE_STATE_KEY,
    };
}

/**
 * Options for J2 "Open a source": the click on the Xtream portal card (or its
 * source row) starts the journey; it ends when the section's category list in
 * the context panel and the first page of its items are visible.
 */
export function createOpenSourceJourneyProbeOptions(): JourneyRendererProbeOptions {
    return {
        // Grid cards (VOD/series, the section a portal opens on), content
        // cards and live channel rows; skeleton cards are not matched.
        cardSelector:
            'app-grid-list mat-card, .content-card, [data-test-id="channel-item"]',
        cdTickCounterKey: JOURNEY_CD_TICK_COUNTER_KEY,
        companionSelectors: ['app-workspace-context-panel .category-item'],
        journey: 'open-source',
        routeFragment: '/workspace/xtreams/',
        sentinelId: JOURNEY_OPEN_SOURCE_END_SENTINEL_ID,
        sentinelMethod: JOURNEY_IPC_SENTINEL_METHOD,
        splashId: 'initial-splash',
        startClick: {
            selector: JOURNEY_OPEN_SOURCE_START_SELECTOR,
            sentinelId: JOURNEY_OPEN_SOURCE_START_SENTINEL_ID,
        },
        stateKey: JOURNEY_OPEN_SOURCE_PROBE_STATE_KEY,
    };
}

/**
 * Options for J3 "Playback": the click on a live channel row starts the
 * journey; it ends at the first `playing` event of the HTML5 player's video
 * element, with `loadedmetadata` recorded as an intermediate phase.
 */
export function createPlaybackJourneyProbeOptions(): JourneyRendererProbeOptions {
    return {
        cardSelector: JOURNEY_PLAYBACK_VIDEO_SELECTOR,
        cdTickCounterKey: JOURNEY_CD_TICK_COUNTER_KEY,
        journey: 'playback',
        media: { endEvent: 'playing', phaseEvents: ['loadedmetadata'] },
        routeFragment: '/workspace/xtreams/',
        sentinelId: JOURNEY_PLAYBACK_END_SENTINEL_ID,
        sentinelMethod: JOURNEY_IPC_SENTINEL_METHOD,
        splashId: 'initial-splash',
        startClick: {
            selector: JOURNEY_PLAYBACK_START_SELECTOR,
            sentinelId: JOURNEY_PLAYBACK_START_SENTINEL_ID,
        },
        stateKey: JOURNEY_PLAYBACK_PROBE_STATE_KEY,
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

/**
 * Arms a click-started probe in the current document. Playwright serializes
 * the same self-contained script as for `addInitScript`.
 */
export async function armJourneyRendererProbe(
    page: Page,
    options: JourneyRendererProbeOptions
): Promise<void> {
    if (!options.startClick) {
        throw new Error('journey-renderer-probe-arm-needs-start-click');
    }
    await page.evaluate(journeyRendererProbeScript, options);
}

export async function waitForJourneyRendererProbe(
    page: Page,
    stateKey: string,
    timeoutMs: number
): Promise<JourneyRendererProbeState> {
    // A settle window, where enabled, ends after `final`, and an idle
    // window after that.
    await page.waitForFunction(
        (key) => {
            const state = (
                globalThis as unknown as Record<
                    string,
                    {
                        final?: boolean;
                        idle?: { status?: string };
                        settle?: { status?: string };
                    }
                >
            )[key];
            return (
                state?.final === true &&
                state.settle?.status !== 'pending' &&
                state.idle?.status !== 'pending'
            );
        },
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
    if (state.settle.status === 'pending') {
        throw new Error('journey-renderer-probe-settle-pending');
    }
    if (state.idle.status === 'pending') {
        throw new Error('journey-renderer-probe-idle-pending');
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
    if (state.start !== null && state.start.sentinelStatus !== 'sent') {
        throw new Error(
            `journey-renderer-probe-start-sentinel-${state.start.sentinelStatus}`
        );
    }
    // A zero from an observer that never ran is not a measurement; a build
    // without these entry types must fail the iteration, never lower a
    // baseline.
    const missing = (['layoutShift', 'longTask'] as const).filter(
        (capability) => !state.capabilities[capability]
    );
    if (missing.length > 0) {
        throw new Error(
            `journey-renderer-probe-observer-unavailable: ${missing.join(', ')}`
        );
    }
    return state;
}
