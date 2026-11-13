import {
    DestroyRef,
    computed,
    effect,
    inject,
    signal,
    untracked,
} from '@angular/core';
import type { MultiviewConnectionBudget } from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { PlaylistsService } from '@iptvnator/services';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import { connectionBudgetBadge } from './connection-budget';
import { ConnectionBudgetService } from './connection-budget.service';
import { MultiviewOnScreenSources } from './multiview-on-screen';
import {
    MultiviewPickerMemory,
    type MultiviewPickerDialogData,
    type MultiviewPickerResult,
} from './multiview-picker-context';
import {
    type MultiviewPickerData,
    MultiviewPickerDataService,
} from './multiview-picker-data.service';
import { loadVisibleEpg, MultiviewEpgAllowance } from './multiview-picker-epg';
import {
    loadPickerPlaylist,
    type MultiviewPickerPlaylist,
} from './multiview-picker-playlist';
import {
    listForType,
    type MultiviewPickerType,
    nextActiveKey,
    rowsOf,
    searchGroups,
    sectionGroups,
    typeCounts,
} from './multiview-picker-list';
import type { MultiviewPickerRow } from './multiview-picker-row';
import type { MultiviewPickerSearchResults } from './multiview-picker-search';
import { MultiviewPickerSearchService } from './multiview-picker-search.service';
import {
    defaultPickerSection,
    type MultiviewPickerSectionId,
} from './multiview-picker-sections';
import {
    type MultiviewEpisodeRow,
    MultiviewSeriesEpisodesService,
} from './multiview-series-episodes.service';
import {
    isPickableRow,
    MultiviewTileResolverService,
} from './multiview-tile-resolver';

const SEARCH_DEBOUNCE_MS = 200;
/** Rows near the top that count as visible for the EPG allowance. */
const VISIBLE_ROWS = 12;

/**
 * State and actions of one open picker. Created by the dialog component in
 * its injection context; aborts its loads when the dialog closes.
 */
export class MultiviewPickerController {
    private readonly dataService = inject(MultiviewPickerDataService);
    private readonly searchService = inject(MultiviewPickerSearchService);
    private readonly resolver = inject(MultiviewTileResolverService);
    private readonly episodes = inject(MultiviewSeriesEpisodesService);
    private readonly budgets = inject(ConnectionBudgetService);
    private readonly memory = inject(MultiviewPickerMemory);
    private readonly onScreen = inject(MultiviewOnScreenSources);
    private readonly playlists = inject(PlaylistsService);
    private readonly abort = new AbortController();
    private readonly allowance = new MultiviewEpgAllowance();

    readonly loadState = signal<'loading' | 'ready' | 'error'>('loading');
    readonly data = signal<MultiviewPickerData | null>(null);
    readonly section = signal<MultiviewPickerSectionId>('live-now');
    readonly type = signal<MultiviewPickerType>('all');
    readonly query = signal('');
    readonly results = signal<MultiviewPickerSearchResults | null>(null);
    private readonly requery = signal(0);
    readonly programs = signal<ReadonlyMap<string, EpgProgram | null>>(
        new Map()
    );
    /** undefined while it loads; null when the provider reports none. */
    readonly budget = signal<MultiviewConnectionBudget | null | undefined>(
        undefined
    );
    /** The current playlist as the navigation lists it (Q2). */
    readonly playlist = signal<MultiviewPickerPlaylist | null>(null);
    readonly series = signal<UnifiedCollectionItem | null>(null);
    readonly episodeRows = signal<readonly MultiviewEpisodeRow[] | null>(null);
    readonly activeKey = signal<string | null>(null);
    readonly busyKey = signal<string | null>(null);
    readonly failedKey = signal<string | null>(null);

    readonly sections = computed(() => this.data()?.sections ?? []);
    private readonly baseGroups = computed(() => {
        const results = this.results();
        if (results) return searchGroups(results);
        const id = this.section();
        return sectionGroups(this.sections().find((s) => s.id === id));
    });
    readonly counts = computed(() => typeCounts(this.baseGroups()));
    readonly groups = computed(() =>
        listForType(this.baseGroups(), this.type())
    );
    readonly budgetBadge = computed(() =>
        connectionBudgetBadge(this.budget() ?? null)
    );
    readonly isFull = computed(() => this.budgetBadge().kind === 'full');
    private readonly enabledKeys = computed(() => {
        const episodes = this.episodeRows();
        if (this.series()) {
            return (episodes ?? [])
                .filter((row) => row.inTile === null)
                .map((row) => row.sessionKey);
        }
        return rowsOf(this.groups())
            .filter((row) => this.isEnabled(row))
            .map((row) => row.sessionKey);
    });

    constructor(
        readonly context: MultiviewPickerDialogData,
        private readonly close: (result: MultiviewPickerResult) => void
    ) {
        this.section.set(
            defaultPickerSection(context.mainKind, this.memory.lastSection)
        );
        inject(DestroyRef).onDestroy(() => this.abort.abort());
        void this.load();
        void this.loadBudget();
        this.searchAsTyped();
        loadVisibleEpg({
            visible: () =>
                rowsOf(this.groups())
                    .slice(0, VISIBLE_ROWS)
                    .map((row) => row.item),
            load: (items) => this.dataService.loadEpg(items, this.allowance),
            apply: (loaded) =>
                this.programs.update((current) => {
                    const next = new Map(current);
                    loaded.forEach((program, key) => next.set(key, program));
                    return next;
                }),
        });
        effect(() => {
            const keys = this.enabledKeys();
            untracked(() => {
                const active = this.activeKey();
                if (active === null || !keys.includes(active)) {
                    this.activeKey.set(keys[0] ?? null);
                }
            });
        });
    }

    isEnabled(row: MultiviewPickerRow): boolean {
        return row.inTile === null && isPickableRow(row);
    }

    programOf(row: MultiviewPickerRow): EpgProgram | null {
        return (
            this.dataService.programFor(row.item, this.programs()) ??
            row.program
        );
    }

    selectSection(id: MultiviewPickerSectionId): void {
        this.memory.lastSection = id;
        this.section.set(id);
        this.closeEpisodes();
        // A typed query stays and is searched again in the new scope.
        this.requery.update((n) => n + 1);
    }

    move(step: 1 | -1): void {
        this.activeKey.set(
            nextActiveKey(this.enabledKeys(), this.activeKey(), step)
        );
    }

    /** Enter: picks the active row or episode. */
    chooseActive(): void {
        const key = this.activeKey();
        const episode = this.episodeRows()?.find((r) => r.sessionKey === key);
        if (this.series() && episode) {
            void this.chooseEpisode(episode);
            return;
        }
        const row = rowsOf(this.groups()).find(
            (candidate) => candidate.sessionKey === key
        );
        if (row) void this.choose(row);
    }

    async choose(row: MultiviewPickerRow): Promise<void> {
        if (!this.isEnabled(row) || this.busyKey()) return;
        if (row.item.contentType === 'series') {
            await this.openEpisodes(row.item);
            return;
        }
        await this.settle(row.sessionKey, row.item, () =>
            this.resolver.resolve(row)
        );
    }

    async chooseEpisode(row: MultiviewEpisodeRow): Promise<void> {
        const series = this.series();
        if (!series || row.inTile !== null || this.busyKey()) return;
        await this.settle(row.sessionKey, series, () =>
            this.episodes.resolve(series, row)
        );
    }

    async openEpisodes(series: UnifiedCollectionItem): Promise<void> {
        this.series.set(series);
        this.episodeRows.set(null);
        try {
            const rows = await this.episodes.load(
                series,
                this.onScreen.current()
            );
            if (this.series() !== series) return;
            this.episodeRows.set(rows);
            const resume = [...rows]
                .filter((row) => row.position && row.inTile === null)
                .sort((a, b) =>
                    (b.position?.updatedAt ?? '').localeCompare(
                        a.position?.updatedAt ?? ''
                    )
                )[0];
            if (resume) this.activeKey.set(resume.sessionKey);
        } catch {
            if (this.series() === series) this.episodeRows.set([]);
        }
    }

    closeEpisodes(): void {
        this.series.set(null);
        this.episodeRows.set(null);
    }

    private async settle(
        key: string,
        item: UnifiedCollectionItem,
        resolve: () => Promise<MultiviewPickerResult['source']>
    ): Promise<void> {
        this.busyKey.set(key);
        this.failedKey.set(null);
        try {
            this.close({ source: await resolve(), item });
        } catch {
            this.failedKey.set(key);
        } finally {
            this.busyKey.set(null);
        }
    }

    private async load(): Promise<void> {
        try {
            this.data.set(
                await this.dataService.load(
                    this.context.playlistId,
                    this.abort.signal
                )
            );
            this.loadState.set('ready');
            this.avoidEmptyDefault();
        } catch {
            this.loadState.set('error');
        }
    }

    /**
     * The spec's default (Continue next to a channel) can be empty, in a
     * fresh profile for one; until the viewer chose a section, an empty
     * default gives way to Live now.
     */
    private avoidEmptyDefault(): void {
        const id = this.section();
        const empty = !this.sections().find((s) => s.id === id)?.count;
        if (this.memory.lastSection === null && empty) {
            this.section.set('live-now');
        }
    }

    private async loadBudget(): Promise<void> {
        const id = this.context.playlistId;
        const loaded = id
            ? await loadPickerPlaylist(id, this.playlists, this.budgets)
            : null;
        this.playlist.set(loaded?.playlist ?? null);
        this.budget.set(loaded?.budget ?? null);
    }

    /** With the playlist selected, search runs inside it (scope chip). */
    readonly scopedToPlaylist = computed(() => this.section() === 'playlist');

    private searchRows(): MultiviewPickerRow[] {
        const scoped = this.scopedToPlaylist();
        const rows: MultiviewPickerRow[] = [];
        for (const section of this.sections()) {
            if (!scoped || section.id === 'playlist') {
                rows.push(...rowsOf(section.groups));
            }
        }
        // Programme lines loaded so far take part in "On air now".
        return rows.map((row) => {
            const program = this.programOf(row);
            return program === row.program ? row : { ...row, program };
        });
    }

    private searchAsTyped(): void {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let searchRun = 0;
        inject(DestroyRef).onDestroy(() => clearTimeout(timer));
        effect(() => {
            const term = this.query().trim();
            this.data();
            this.requery();
            this.programs();
            untracked(() => {
                clearTimeout(timer);
                if (!term) {
                    searchRun += 1;
                    this.results.set(null);
                    return;
                }
                this.series.set(null);
                // Each run supersedes the previous one: a scope, data or
                // EPG change re-runs the same term.
                const run = ++searchRun;
                timer = setTimeout(async () => {
                    const results = await this.searchService.search(
                        term,
                        this.searchRows(),
                        this.context.playlistId
                    );
                    if (run === searchRun) this.results.set(results);
                }, SEARCH_DEBOUNCE_MS);
            });
        });
    }
}
