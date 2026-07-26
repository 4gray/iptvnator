/* eslint-disable playwright/expect-expect -- These are Node assertion-based performance contract tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

type WorkerKind = 'database.worker' | 'playlist-refresh.worker';

interface TestWorkerRecord {
    readonly captureGeneration: number | null;
    readonly finalized: boolean;
    readonly kind: WorkerKind;
    readonly ordinal: number;
    readonly pendingCount: number;
    readonly sampleTimer: object | null;
}

type SelectionReason =
    | 'database-worker-missing'
    | 'database-worker-not-idle'
    | 'multiple-database-workers';

interface Selection<T> {
    readonly selected: T | null;
    readonly unavailableReason: SelectionReason | null;
}

type Selector = <T extends TestWorkerRecord>(
    records: readonly T[],
    activeGeneration: number
) => Selection<T>;

interface SelectionModule {
    createDatabaseWorkerPostGcSelectionApi?: () => {
        readonly select: Selector;
    };
}

const selectionModulePromise = import(
    new URL('./database-worker-post-gc-selection.ts', import.meta.url).href
)
    .then((module) => module as SelectionModule)
    .catch(() => null);

function workerRecord(
    ordinal: number,
    overrides: Partial<TestWorkerRecord> = {}
): TestWorkerRecord {
    return {
        captureGeneration: 7,
        finalized: true,
        kind: 'database.worker',
        ordinal,
        pendingCount: 0,
        sampleTimer: null,
        ...overrides,
    };
}

async function restoreSerializableSelector(): Promise<Selector> {
    const module = await selectionModulePromise;
    assert.ok(module, 'database worker post-GC selector module must exist');
    const factory = module.createDatabaseWorkerPostGcSelectionApi;
    assert.equal(typeof factory, 'function');
    const source = factory.toString();
    assert.doesNotMatch(source, /__name/);

    const restoredFactory = Function(
        `"use strict"; return (${source});`
    )() as () => {
        readonly select: Selector;
    };
    return restoredFactory().select;
}

test('selects the only current-generation database worker independently of sampling and finalization state', async () => {
    const select = await restoreSerializableSelector();
    const currentDatabase = workerRecord(4, {
        finalized: true,
        sampleTimer: null,
    });
    const previousDatabase = workerRecord(1, {
        captureGeneration: 6,
        finalized: false,
        sampleTimer: {},
    });
    const currentPlaylist = workerRecord(2, {
        finalized: false,
        kind: 'playlist-refresh.worker',
        sampleTimer: {},
    });

    const selection = select(
        [previousDatabase, currentPlaylist, currentDatabase],
        7
    );

    assert.equal(selection.selected, currentDatabase);
    assert.deepEqual(selection, {
        selected: currentDatabase,
        unavailableReason: null,
    });
});

test('reports a missing database worker after ignoring playlists and previous generations', async () => {
    const select = await restoreSerializableSelector();

    assert.deepEqual(
        select(
            [
                workerRecord(1, { captureGeneration: 6 }),
                workerRecord(2, { kind: 'playlist-refresh.worker' }),
            ],
            7
        ),
        {
            selected: null,
            unavailableReason: 'database-worker-missing',
        }
    );
});

test('fails closed for multiple current-generation database workers instead of taking the first', async () => {
    const select = await restoreSerializableSelector();
    const first = workerRecord(1, {
        finalized: false,
        sampleTimer: {},
    });
    const second = workerRecord(2, {
        finalized: true,
        sampleTimer: null,
    });

    assert.deepEqual(select([first, second], 7), {
        selected: null,
        unavailableReason: 'multiple-database-workers',
    });
});

test('fails closed while the only current-generation database worker is not idle', async () => {
    const select = await restoreSerializableSelector();

    assert.deepEqual(select([workerRecord(3, { pendingCount: 2 })], 7), {
        selected: null,
        unavailableReason: 'database-worker-not-idle',
    });
});
