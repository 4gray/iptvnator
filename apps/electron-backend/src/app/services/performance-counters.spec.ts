import { EventEmitter } from 'node:events';
import {
    attachMainWindowPerformanceCounters,
    createPerformanceCounterRegistry,
    PERFORMANCE_COUNTER,
    PERFORMANCE_COUNTERS_READ_CHANNEL,
    registerPerformanceCountersHandler,
} from './performance-counters';

function createRegistry(enabled = true, epochs = [1_000, 2_000, 3_000]) {
    let flag = enabled;
    const clock = [...epochs];
    const registry = createPerformanceCounterRegistry(
        () => flag,
        () => clock.shift() ?? -1
    );
    return {
        registry,
        setEnabled(value: boolean) {
            flag = value;
        },
    };
}

describe('performance counter registry', () => {
    it('counts nothing while capture is disabled', () => {
        const { registry } = createRegistry(false);

        registry.increment(PERFORMANCE_COUNTER.SQL_STATEMENTS, 4);
        registry.freeze(
            PERFORMANCE_COUNTER.SQL_STATEMENTS,
            PERFORMANCE_COUNTER.SQL_STATEMENTS_BEFORE_READY_TO_SHOW
        );

        expect(registry.read()).toEqual({ counters: {}, frozenAtEpochMs: {} });
    });

    it('adds only positive safe integers', () => {
        const { registry } = createRegistry();

        registry.increment('main.sqlStatements');
        registry.increment('main.sqlStatements', 3);
        for (const invalid of [0, -2, 1.5, Number.NaN, 2 ** 53]) {
            registry.increment('main.sqlStatements', invalid);
        }

        expect(registry.read().counters).toEqual({ 'main.sqlStatements': 4 });
    });

    it('freezes a counter once, with the epoch it was taken at', () => {
        const { registry } = createRegistry();
        registry.increment('main.sqlStatements', 5);

        registry.freeze('main.sqlStatements', 'main.frozen');
        registry.increment('main.sqlStatements', 2);
        registry.freeze('main.sqlStatements', 'main.frozen');

        expect(registry.read()).toEqual({
            counters: { 'main.frozen': 5, 'main.sqlStatements': 7 },
            frozenAtEpochMs: { 'main.frozen': 1_000 },
        });
    });

    it('freezes a counter that was never incremented as zero', () => {
        const { registry } = createRegistry();

        registry.freeze('main.sqlStatements', 'main.frozen');

        expect(registry.read().counters).toEqual({ 'main.frozen': 0 });
    });

    it('returns sorted copies that later increments do not change', () => {
        const { registry } = createRegistry();
        registry.increment('main.b');
        registry.increment('main.a');

        const snapshot = registry.read();
        registry.increment('main.a');

        expect(Object.keys(snapshot.counters)).toEqual(['main.a', 'main.b']);
        expect(snapshot.counters['main.a']).toBe(1);
    });
});

describe('performance:read-counters handler', () => {
    it('is not registered without the capture flag', () => {
        const ipcMain = { handle: jest.fn() };
        const { registry } = createRegistry();

        expect(
            registerPerformanceCountersHandler(ipcMain, registry, false)
        ).toBe(false);
        expect(ipcMain.handle).not.toHaveBeenCalled();
    });

    it('returns the registry snapshot when the flag is on', async () => {
        const ipcMain = { handle: jest.fn() };
        const { registry } = createRegistry();
        registry.increment(PERFORMANCE_COUNTER.STARTUP_PHASES, 2);

        expect(
            registerPerformanceCountersHandler(ipcMain, registry, true)
        ).toBe(true);
        expect(ipcMain.handle).toHaveBeenCalledTimes(1);
        const [channel, handler] = ipcMain.handle.mock.calls[0];
        expect(channel).toBe(PERFORMANCE_COUNTERS_READ_CHANNEL);
        expect(channel).toBe('performance:read-counters');
        expect(await handler({})).toEqual({
            counters: { 'main.startupPhases': 2 },
            frozenAtEpochMs: {},
        });
    });
});

describe('main window performance counters', () => {
    const BOTH_FLAGS = { capture: true, sqlStatements: true };

    it('attaches nothing without the capture flag', () => {
        const window = new EventEmitter();
        const { registry } = createRegistry();

        attachMainWindowPerformanceCounters(window, registry, {
            capture: false,
            sqlStatements: false,
        });

        expect(window.listenerCount('ready-to-show')).toBe(0);
        expect(registry.read().counters).toEqual({});
    });

    it('freezes only the startup phases when SQL is not counted', () => {
        const window = new EventEmitter();
        const { registry } = createRegistry();
        registry.increment(PERFORMANCE_COUNTER.STARTUP_PHASES, 2);

        attachMainWindowPerformanceCounters(window, registry, {
            capture: true,
            sqlStatements: false,
        });
        window.emit('ready-to-show');

        expect(window.listenerCount('ready-to-show')).toBe(0);
        expect(registry.read().counters).toEqual({
            'main.modulesRegisteredBeforeWindow': 2,
            'main.startupPhases': 2,
        });
    });

    it('freezes startup phases at creation and SQL at ready-to-show', () => {
        const window = new EventEmitter();
        const { registry } = createRegistry();
        registry.increment(PERFORMANCE_COUNTER.STARTUP_PHASES, 2);
        registry.increment(PERFORMANCE_COUNTER.SQL_STATEMENTS, 3);

        attachMainWindowPerformanceCounters(window, registry, BOTH_FLAGS);
        registry.increment(PERFORMANCE_COUNTER.STARTUP_PHASES);
        registry.increment(PERFORMANCE_COUNTER.SQL_STATEMENTS, 4);
        window.emit('ready-to-show');
        registry.increment(PERFORMANCE_COUNTER.SQL_STATEMENTS, 9);

        expect(registry.read()).toEqual({
            counters: {
                'main.modulesRegisteredBeforeWindow': 2,
                'main.sqlStatements': 16,
                'main.sqlStatementsBeforeReadyToShow': 7,
                'main.startupPhases': 3,
            },
            frozenAtEpochMs: {
                'main.modulesRegisteredBeforeWindow': 1_000,
                'main.sqlStatementsBeforeReadyToShow': 2_000,
            },
        });
    });

    it('keeps the first window values when a window is re-created', () => {
        const first = new EventEmitter();
        const second = new EventEmitter();
        const { registry } = createRegistry();
        registry.increment(PERFORMANCE_COUNTER.STARTUP_PHASES, 2);
        attachMainWindowPerformanceCounters(first, registry, BOTH_FLAGS);
        first.emit('ready-to-show');

        registry.increment(PERFORMANCE_COUNTER.STARTUP_PHASES, 5);
        registry.increment(PERFORMANCE_COUNTER.SQL_STATEMENTS, 5);
        attachMainWindowPerformanceCounters(second, registry, BOTH_FLAGS);
        second.emit('ready-to-show');

        expect(registry.read().counters).toMatchObject({
            'main.modulesRegisteredBeforeWindow': 2,
            'main.sqlStatementsBeforeReadyToShow': 0,
        });
    });
});
