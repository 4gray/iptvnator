import * as sharedLogging from '../index';

type RendererPerformancePhase =
    | 'store.m3u-import-dispatch'
    | 'store.m3u-publish-channels'
    | 'store.xtream-delete-row'
    | 'store.xtream-import-terminal'
    | 'store.xtream-publish-categories'
    | 'store.xtream-publish-live'
    | 'store.xtream-publish-series'
    | 'store.xtream-publish-vod'
    | 'store.xtream-refresh-meta'
    | 'store.xtream-search-results';
type RendererPerformancePhaseOutcome = 'error' | 'success';

interface RendererPerformancePhaseEvent {
    readonly boundary: 'end' | 'start';
    readonly epochMs: number;
    readonly metadata?: Readonly<{ items: number }>;
    readonly monotonicMs: number;
    readonly outcome?: RendererPerformancePhaseOutcome;
    readonly phase: RendererPerformancePhase;
    readonly phaseId: string;
    readonly schemaVersion: 1;
}

type RendererPerformancePhaseHook = (
    event: RendererPerformancePhaseEvent
) => void;

interface RendererPerformancePhaseModule {
    readonly measureRendererPerformancePhase?: <T>(
        phase: RendererPerformancePhase,
        execute: () => T,
        metadata?: () => Readonly<{ items: number }>
    ) => T;
    readonly RENDERER_PERFORMANCE_PHASE?: Readonly<{
        M3U_IMPORT_DISPATCH: 'store.m3u-import-dispatch';
        M3U_PUBLISH_CHANNELS: 'store.m3u-publish-channels';
        XTREAM_DELETE_ROW: 'store.xtream-delete-row';
        XTREAM_IMPORT_TERMINAL: 'store.xtream-import-terminal';
        XTREAM_PUBLISH_CATEGORIES: 'store.xtream-publish-categories';
        XTREAM_PUBLISH_LIVE: 'store.xtream-publish-live';
        XTREAM_PUBLISH_SERIES: 'store.xtream-publish-series';
        XTREAM_PUBLISH_VOD: 'store.xtream-publish-vod';
        XTREAM_REFRESH_META: 'store.xtream-refresh-meta';
        XTREAM_SEARCH_RESULTS: 'store.xtream-search-results';
    }>;
    readonly RENDERER_PERFORMANCE_PHASE_HOOK_KEY?: string;
}

const rendererPerformance =
    sharedLogging as unknown as RendererPerformancePhaseModule;
const EXPECTED_HOOK_KEY = 'iptvnator.renderer.performance-phase-hook.v1';
const hookSymbol = Symbol.for(EXPECTED_HOOK_KEY);

function measure<T>(
    phase: RendererPerformancePhase,
    execute: () => T,
    metadata?: () => Readonly<{ items: number }>
): T {
    const measurePhase = rendererPerformance.measureRendererPerformancePhase;
    expect(typeof measurePhase).toBe('function');
    if (measurePhase === undefined) {
        throw new Error('renderer performance phase helper is unavailable');
    }
    return measurePhase(phase, execute, metadata);
}

function setHook(hook: RendererPerformancePhaseHook | null): void {
    const target = globalThis as unknown as Record<symbol, unknown>;
    if (hook === null) {
        delete target[hookSymbol];
        return;
    }
    target[hookSymbol] = hook;
}

describe('renderer performance phases', () => {
    afterEach(() => {
        setHook(null);
        jest.restoreAllMocks();
    });

    it('does not evaluate metadata while the global opt-in hook is absent', () => {
        const metadata = jest.fn(() => ({ items: 3 }));
        const resultIdentity = { imported: true };

        const result = measure(
            'store.m3u-publish-channels',
            () => resultIdentity,
            metadata
        );

        expect(result).toBe(resultIdentity);
        expect(metadata).not.toHaveBeenCalled();
    });

    it('emits an immutable successful pair with epoch and monotonic timestamps', () => {
        const events: RendererPerformancePhaseEvent[] = [];
        setHook((event) => events.push(event));
        const resultIdentity = { imported: true };

        const result = measure(
            'store.m3u-publish-channels',
            () => resultIdentity,
            () => ({ items: 3 })
        );

        expect(result).toBe(resultIdentity);
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            boundary: 'start',
            metadata: { items: 3 },
            phase: 'store.m3u-publish-channels',
            schemaVersion: 1,
        });
        expect(events[1]).toMatchObject({
            boundary: 'end',
            metadata: { items: 3 },
            outcome: 'success',
            phase: 'store.m3u-publish-channels',
            schemaVersion: 1,
        });
        expect(events[1].phaseId).toBe(events[0].phaseId);
        expect(events[0].epochMs).toEqual(expect.any(Number));
        expect(events[0].monotonicMs).toEqual(expect.any(Number));
        expect(events[1].epochMs).toBeGreaterThanOrEqual(events[0].epochMs);
        expect(events[1].monotonicMs).toBeGreaterThanOrEqual(
            events[0].monotonicMs
        );
        expect(Object.isFrozen(events[0])).toBe(true);
        expect(Object.isFrozen(events[0].metadata)).toBe(true);
        expect(events[1].metadata).toBe(events[0].metadata);
    });

    it('emits an error boundary and rethrows the exact product error', () => {
        const events: RendererPerformancePhaseEvent[] = [];
        setHook((event) => events.push(event));
        const productError = new Error('dispatch failed');

        let thrown: unknown;
        try {
            measure('store.m3u-import-dispatch', () => {
                throw productError;
            });
        } catch (error: unknown) {
            thrown = error;
        }

        expect(thrown).toBe(productError);
        expect(events).toHaveLength(2);
        expect(events[1]).toMatchObject({
            boundary: 'end',
            outcome: 'error',
            phase: 'store.m3u-import-dispatch',
        });
        expect(events[1].phaseId).toBe(events[0].phaseId);
    });

    it('keeps product results and errors unchanged when metadata or hooks fail', () => {
        setHook(() => {
            throw new Error('benchmark hook failed');
        });
        const resultIdentity = { imported: true };

        expect(
            measure(
                'store.m3u-publish-channels',
                () => resultIdentity,
                () => {
                    throw new Error('metadata failed');
                }
            )
        ).toBe(resultIdentity);

        const productError = new Error('product failed');
        let thrown: unknown;
        try {
            measure('store.m3u-import-dispatch', () => {
                throw productError;
            });
        } catch (error: unknown) {
            thrown = error;
        }
        expect(thrown).toBe(productError);
    });

    it('exposes only the fixed phase vocabulary and item-count metadata', () => {
        expect(rendererPerformance.RENDERER_PERFORMANCE_PHASE_HOOK_KEY).toBe(
            EXPECTED_HOOK_KEY
        );
        expect(rendererPerformance.RENDERER_PERFORMANCE_PHASE).toEqual({
            M3U_IMPORT_DISPATCH: 'store.m3u-import-dispatch',
            M3U_PUBLISH_CHANNELS: 'store.m3u-publish-channels',
            XTREAM_DELETE_ROW: 'store.xtream-delete-row',
            XTREAM_IMPORT_TERMINAL: 'store.xtream-import-terminal',
            XTREAM_PUBLISH_CATEGORIES: 'store.xtream-publish-categories',
            XTREAM_PUBLISH_LIVE: 'store.xtream-publish-live',
            XTREAM_PUBLISH_SERIES: 'store.xtream-publish-series',
            XTREAM_PUBLISH_VOD: 'store.xtream-publish-vod',
            XTREAM_REFRESH_META: 'store.xtream-refresh-meta',
            XTREAM_SEARCH_RESULTS: 'store.xtream-search-results',
        });

        const events: RendererPerformancePhaseEvent[] = [];
        setHook((event) => events.push(event));
        measure(
            'store.m3u-publish-channels',
            () => undefined,
            () =>
                ({
                    items: 2,
                    playlistUrl: 'https://user:secret@example.test/list.m3u',
                }) as { items: number }
        );

        expect(events.map((event) => event.metadata)).toEqual([
            { items: 2 },
            { items: 2 },
        ]);
        expect(JSON.stringify(events)).not.toContain('secret');
        expect(JSON.stringify(events)).not.toContain('playlistUrl');
    });
});
