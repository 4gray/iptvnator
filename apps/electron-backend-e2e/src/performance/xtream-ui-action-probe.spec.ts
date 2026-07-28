import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface UiActionModule {
    XTREAM_UI_ACTION_ORDER?: readonly string[];
    runXtreamBackgroundUiActions?: (
        page: unknown,
        options: {
            readonly operationId: string;
            readonly playlistId: string;
            readonly searchTerm: string;
        }
    ) => Promise<unknown>;
    summarizeXtreamUiActionSamples?: (
        samples: readonly {
            readonly category: 'action' | 'navigation' | 'search';
            readonly endEpochMs: number;
            readonly kind: string;
            readonly latencyMs: number;
            readonly startEpochMs: number;
        }[]
    ) => {
        readonly action: {
            readonly max: number | null;
            readonly p95: number | null;
        };
        readonly navigation: {
            readonly max: number | null;
            readonly p95: number | null;
        };
        readonly search: {
            readonly max: number | null;
            readonly p95: number | null;
        };
    };
}

const sourceUrl = new URL('./xtream-ui-action-probe.ts', import.meta.url);
const modulePromise = import(sourceUrl.href)
    .then((module) => module as unknown as UiActionModule)
    .catch(() => null);

test('exports the fixed background interaction sequence', async () => {
    const module = await modulePromise;

    assert.ok(module, 'Xtream UI action probe module must exist');
    assert.equal(typeof module.runXtreamBackgroundUiActions, 'function');
    assert.deepEqual(module.XTREAM_UI_ACTION_ORDER, [
        'type-filter',
        'dashboard',
        'sources',
        'name-a-z',
        'global-search',
    ]);
});

test('requires the full refresh lifecycle before and after every action', () => {
    const source = readFileSync(sourceUrl, 'utf8');

    assert.match(source, /assertXtreamBackgroundRefreshActive/);
    assert.match(source, /refresh-lifecycle/);
    assert.doesNotMatch(source, /assertXtreamBackgroundDeleteActive/);
    assert.match(source, /activeBefore/);
    assert.match(source, /activeAfter/);
});

test('uses the concrete UI controls and two-frame paint gates', () => {
    const source = readFileSync(sourceUrl, 'utf8');

    assert.match(source, /app-workspace-sources-filters-panel/);
    assert.match(source, /Xtream/);
    assert.match(source, /workspace\/dashboard/);
    assert.match(source, /lib-workspace-dashboard-rails/);
    assert.match(source, /workspace-loading-overlay/);
    assert.match(source, /workspace\/sources/);
    assert.match(source, /input\[type="search"\]/);
    assert.match(source, /Name \(A-Z\)/);
    assert.match(source, /requestAnimationFrame/);
});

test('keeps the debounced search last and finishes only after its result paint', async () => {
    const module = await modulePromise;
    assert.ok(module?.runXtreamBackgroundUiActions);
    const page = new SearchCompletionFakePage();

    await module.runXtreamBackgroundUiActions(page, {
        operationId: 'delete-operation-1',
        playlistId: 'playlist-1',
        searchTerm: 'Performance',
    });

    assert.equal(
        page.searchGateObserved,
        true,
        'the current input-only gate lets the probe finish before the app-owned 350 ms q/filter update'
    );
    assert.equal(
        page.searchRestored,
        false,
        'an unmeasured search reset must not consume the remaining delete window'
    );
    assert.deepEqual(page.searchPaintOrder, [
        'app-owned-search-complete',
        'two-rendered-frames',
    ]);
});

test('retains raw samples and summarizes navigation, search, and other actions separately', async () => {
    const module = await modulePromise;
    assert.ok(module?.summarizeXtreamUiActionSamples);
    const samples = [
        sample('action', 'type-filter', 10),
        sample('navigation', 'dashboard', 20),
        sample('navigation', 'sources', 40),
        sample('action', 'name-a-z', 50),
        sample('search', 'global-search', 30),
    ] as const;

    const summary = module.summarizeXtreamUiActionSamples(samples);

    assert.equal(summary.action.max, 50);
    assert.equal(summary.navigation.max, 40);
    assert.equal(summary.search.max, 30);
    assert.ok((summary.action.p95 ?? 0) >= 10);
    assert.ok((summary.navigation.p95 ?? 0) >= 20);
});

function sample(
    category: 'action' | 'navigation' | 'search',
    kind: string,
    latencyMs: number
) {
    return {
        category,
        endEpochMs: 100 + latencyMs,
        kind,
        latencyMs,
        startEpochMs: 100,
    };
}

class SearchCompletionFakePage {
    private epochMs = 100;
    private searchWaitVisited = false;
    private searchResultsApplied = false;
    readonly searchPaintOrder: string[] = [];
    searchGateObserved = false;
    searchRestored = false;

    async evaluate<T>(callback: (...args: never[]) => unknown): Promise<T> {
        const source = callback.toString();
        if (
            this.searchWaitVisited &&
            source.includes('requestAnimationFrame') &&
            this.searchPaintOrder.length === 1
        ) {
            this.searchPaintOrder.push('two-rendered-frames');
        }
        this.epochMs += 1;
        return this.epochMs as T;
    }

    async waitForFunction(
        callback: (...args: never[]) => unknown,
        argument?: unknown
    ): Promise<void> {
        const searchTerm = recordString(argument, 'searchTerm');
        if (searchTerm === null) return;
        this.searchWaitVisited = true;
        const source = callback.toString();
        if (searchTerm.length === 0) {
            this.searchRestored =
                /searchParams\.has\((['"])q\1\)/u.test(source) &&
                source.includes('sort-trigger');
            if (this.searchRestored) this.searchResultsApplied = false;
            return;
        }
        this.searchGateObserved =
            /searchParams\.get\((['"])q\1\)/u.test(source) &&
            source.includes('app-playlist-item') &&
            source.includes('no-results-state');
        if (this.searchGateObserved) {
            this.searchResultsApplied = true;
            this.searchPaintOrder.push('app-owned-search-complete');
        }
    }

    getByRole(): { waitFor(): Promise<void> } {
        if (this.searchResultsApplied) {
            throw new Error('sort-control-hidden-by-filtered-no-results');
        }
        return { waitFor: async () => undefined };
    }
}

function recordString(value: unknown, key: string): string | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' ? candidate : null;
}
