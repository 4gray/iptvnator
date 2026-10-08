import {
    effect,
    EnvironmentInjector,
    inject,
    Injectable,
    untracked,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { ChannelActions, selectActive } from '@iptvnator/m3u-state';
import {
    XTREAM_DATA_SOURCE,
    XtreamStore,
} from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { toParentalLockXtreamCategoryType } from '@iptvnator/shared/interfaces';
import { PlaybackKeepAwakeService } from './playback-keep-awake.service';

const XTREAM_ROUTE =
    /^\/workspace\/xtreams\/([^/?#]+)\/(live|vod|series)(?:\/(\d+))?/;
export const STALKER_ROUTE =
    /^\/workspace\/stalker\/([^/?#]+)\/(itv|vod|series|radio)(?:\/([^/?#]+))?/;

/**
 * Applies a parental lock change to the parts of the app that hold catalog
 * data in memory. The stores and the SQLite worker filter what they READ;
 * this service makes them read again and steps off anything that is now
 * withheld — a selected category, a playing channel — so a locked category
 * cannot stay on screen just because it was opened before the lock.
 */
@Injectable({ providedIn: 'root' })
export class ParentalLockEnforcementService {
    private readonly parentalLock = inject(ParentalLockService);
    private readonly xtreamStore = inject(XtreamStore);
    private readonly xtreamDataSource = inject(XTREAM_DATA_SOURCE);
    private readonly injector = inject(EnvironmentInjector);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly keepAwake = inject(PlaybackKeepAwakeService);
    private readonly activeChannel = this.store.selectSignal(selectActive);
    private started = false;
    private lastVersion = -1;
    private applyChain: Promise<void> = Promise.resolve();
    private stalkerModule: StalkerEnforcementModule | null = null;
    private stalkerModuleLoad: Promise<StalkerEnforcementModule> | null = null;

    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        // Playback counts as activity: video through the keep-awake
        // tracker, and audio (the radio player) read directly, since the
        // keep-awake service deliberately ignores <audio>.
        this.parentalLock.registerBusyProbe(
            () => this.keepAwake.hasPlayingVideo() || hasPlayingAudio()
        );
        // The Stalker step is loaded as soon as a Stalker route opens, so a
        // relock there can run it synchronously instead of awaiting a chunk.
        this.router.events?.subscribe((event) => {
            if (
                event instanceof NavigationEnd &&
                STALKER_ROUTE.test(event.urlAfterRedirects)
            ) {
                void this.loadStalker().catch(() => undefined);
            }
        });
        // Any path that makes a channel active (numeric zapping, next /
        // previous, remote commands, a stale list) is checked here: a
        // channel of a locked group is reset as soon as it becomes active.
        effect(() => {
            this.activeChannel();
            untracked(() => {
                if (this.parentalLock.active()) {
                    this.applyM3u();
                }
            });
        });
        effect(() => {
            const version = this.parentalLock.version();
            untracked(() => {
                if (version === this.lastVersion) {
                    return;
                }
                const first = this.lastVersion === -1;
                this.lastVersion = version;
                if (first) {
                    return;
                }
                // Fail closed NOW, ahead of the serialized queue: an earlier
                // apply may still be waiting on a slow (or hung) read, and
                // the catalog, details and playback read while unlocked must
                // not stay usable until it settles.
                if (this.parentalLock.active()) {
                    this.failClosedNow();
                }
                this.scheduleApply();
            });
        });
    }

    /**
     * Applies run one at a time. `ElectronXtreamDataSource` shares in-flight
     * reads per playlist and type, so an unlock refresh still running when
     * "Lock now" arrives would hand the relock its unfiltered rows. Each
     * apply also abandons its result once a newer version exists, leaving
     * the queued apply to read the latest state.
     */
    private scheduleApply(): void {
        this.applyChain = this.applyChain
            .then(() => this.apply())
            .catch((error) => {
                console.error(
                    'Failed to apply the parental lock change.',
                    error
                );
            });
    }

    /**
     * The synchronous half of a relock: M3U channel, Stalker selection (its
     * step is lazy, so it runs as soon as the chunk is there), the Xtream
     * detail the lock store already places in a locked category, the
     * catalog lists and the stored search. The queued apply then reloads
     * the filtered rows and repeats the checks against them.
     */
    private failClosedNow(): void {
        this.applyM3u();
        this.failClosedStalkerNow();
        const playlistId = this.xtreamStore.playlistId?.();
        if (!playlistId) {
            return;
        }
        this.stepOffLockedXtreamSelection(
            playlistId,
            XTREAM_ROUTE.exec(this.router.url)
        );
        this.xtreamStore.withholdCatalog?.();
        this.xtreamStore.clearSearchResults?.();
    }

    private async apply(): Promise<void> {
        const version = this.parentalLock.version();
        // The synchronous surfaces first: an M3U channel or a Stalker
        // selection must not keep playing behind a slow Xtream database or
        // provider reload — the Xtream store stays populated after leaving
        // that portal, so its reload runs on every apply.
        this.applyM3u();
        await this.applyStalker();
        await this.applyXtream(version);
    }

    private async applyXtream(version: number): Promise<void> {
        const playlistId = this.xtreamStore.playlistId?.();
        if (!playlistId) {
            return;
        }
        // A playlist switch retires the apply as a newer lock version
        // does: the store now holds another portal, whose own load reads
        // under the current lock state.
        const shouldPublish = (): boolean =>
            this.parentalLock.version() === version &&
            this.xtreamStore.playlistId?.() === playlistId;
        await this.xtreamStore.reloadCategories(shouldPublish);
        await this.xtreamStore.reloadCachedContent(shouldPublish);
        if (!shouldPublish()) {
            return;
        }
        // Stored in-portal search results are a separate array the search
        // page renders directly; re-run the search so it reads filtered.
        await this.xtreamStore.refreshSearchResults?.();
        if (!shouldPublish() || !this.parentalLock.active()) {
            return;
        }
        await this.stepOffWithheldXtreamSelection(playlistId, shouldPublish);
    }

    /**
     * Post-reload check of the selected Xtream category and item, judged by
     * the LOCK STORE through the unfiltered category rows (hidden and locked
     * ones included): the reloaded list also omits categories the user
     * merely hid, which are not parental-locked. The item is judged on its
     * own category — opened from "All", recently added or search it has no
     * selected category to vanish with. Rows that cannot be read fail
     * closed.
     */
    private async stepOffWithheldXtreamSelection(
        playlistId: string,
        shouldPublish: () => boolean
    ): Promise<void> {
        const match = XTREAM_ROUTE.exec(this.router.url);
        const categoryType = toParentalLockXtreamCategoryType(match?.[2]);
        if (!categoryType) {
            return;
        }
        const rows = await this.xtreamDataSource
            .getAllCategories(playlistId, categoryType)
            .catch(() => null);
        if (!shouldPublish()) {
            return;
        }
        const isWithheld = (categoryId: unknown): boolean => {
            const id = Number(categoryId);
            if (
                categoryId === null ||
                categoryId === undefined ||
                !Number.isFinite(id)
            ) {
                return false;
            }
            const row = rows?.find((candidate) => candidate.id === id);
            return (
                !row ||
                this.parentalLock.isXtreamCategoryLocked(
                    playlistId,
                    categoryType,
                    row.xtream_id
                )
            );
        };
        const selectedItem = this.xtreamStore.selectedItem?.() as {
            category_id?: string | number;
        } | null;
        const itemWithheld = isWithheld(selectedItem?.category_id);
        const categoryWithheld = isWithheld(
            this.xtreamStore.selectedCategoryId()
        );
        if (!itemWithheld && !categoryWithheld) {
            return;
        }
        this.xtreamStore.setSelectedItem(null);
        if (categoryWithheld) {
            this.xtreamStore.setSelectedCategory(null);
        }
        if (match && match[1] === playlistId) {
            void this.router.navigate([
                '/workspace',
                'xtreams',
                match[1],
                match[2],
            ]);
        }
    }

    /**
     * Clears a selected Xtream item whose category the lock store already
     * says is locked. Electron rows carry the SQLite category row id; the
     * category list still on screen maps it to the provider id the store is
     * keyed by, the PWA carries the provider id directly. An item whose
     * category is not in that list (a manually hidden category, opened
     * through search) cannot be judged without an awaited read that may
     * hang, so it is cleared too: fail closed.
     */
    private stepOffLockedXtreamSelection(
        playlistId: string,
        match: RegExpExecArray | null
    ): void {
        const categoryType = toParentalLockXtreamCategoryType(match?.[2]);
        const selectedItem = this.xtreamStore.selectedItem?.() as {
            category_id?: string | number;
        } | null;
        const categoryId = Number(selectedItem?.category_id);
        if (!categoryType || !selectedItem || !Number.isFinite(categoryId)) {
            return;
        }
        const category = this.xtreamStore
            .getCategoriesBySelectedType()
            .find(
                (candidate) =>
                    Number((candidate as { id?: number }).id) === categoryId ||
                    Number(
                        (candidate as { category_id?: string }).category_id
                    ) === categoryId
            ) as { xtream_id?: number; category_id?: string } | undefined;
        const providerId = Number(category?.xtream_id ?? category?.category_id);
        if (
            category &&
            Number.isFinite(providerId) &&
            !this.parentalLock.isXtreamCategoryLocked(
                playlistId,
                categoryType,
                providerId
            )
        ) {
            return;
        }
        this.xtreamStore.setSelectedItem(null);
        if (match && match[1] === playlistId) {
            void this.router.navigate([
                '/workspace',
                'xtreams',
                match[1],
                match[2],
            ]);
        }
    }

    /** The dynamic import; a field so specs can substitute it. */
    loadStalkerEnforcement = (): Promise<StalkerEnforcementModule> =>
        import('./parental-lock-stalker-enforcement');

    /** Loads the Stalker step once; a failed load may be retried. */
    private loadStalker(): Promise<StalkerEnforcementModule> {
        this.stalkerModuleLoad ??= this.loadStalkerEnforcement().then(
            (module) => (this.stalkerModule = module),
            (error: unknown) => {
                this.stalkerModuleLoad = null;
                throw error;
            }
        );
        return this.stalkerModuleLoad;
    }

    /**
     * The relock's Stalker step, synchronously: run it when the chunk is
     * there, otherwise leave the Stalker route at once (its route session
     * clears the selection and the live layout stops playback) rather than
     * wait for a chunk that may be slow or never arrive.
     */
    private failClosedStalkerNow(): void {
        if (!STALKER_ROUTE.test(this.router.url)) {
            return;
        }
        if (!this.stalkerModule) {
            void this.router.navigate(['/workspace', 'sources']);
            return;
        }
        this.stalkerModule.applyParentalLockToStalker(
            this.injector,
            this.parentalLock,
            this.router
        );
    }

    /**
     * The Stalker data layer stays off the initial path: the step is loaded
     * only while a Stalker route is open. Outside one there is nothing to
     * step off — the Stalker route session clears the selection (and the
     * live layout its playback) when the route is left.
     */
    private async applyStalker(): Promise<void> {
        if (!STALKER_ROUTE.test(this.router.url)) {
            return;
        }
        let module: StalkerEnforcementModule;
        try {
            module = await this.loadStalker();
        } catch (error) {
            // Fail closed (e.g. a stale PWA page whose chunk is gone): leave
            // the Stalker route. Its route session clears the selection and
            // the live layout stops playback on the way out, so no locked
            // channel keeps playing; the Xtream step still runs afterwards.
            console.error(
                'The parental lock Stalker step could not be loaded.',
                error
            );
            void this.router.navigate(['/workspace', 'sources']);
            return;
        }
        module.applyParentalLockToStalker(
            this.injector,
            this.parentalLock,
            this.router
        );
    }

    private applyM3u(): void {
        const channel = this.activeChannel();
        const playlistId = this.activeM3uPlaylistId();
        if (!channel || !playlistId) {
            return;
        }
        const groupTitle = channel.group?.title ?? '';
        if (this.parentalLock.isM3uGroupLocked(playlistId, groupTitle)) {
            this.store.dispatch(ChannelActions.resetActiveChannel());
        }
    }

    private activeM3uPlaylistId(): string | null {
        const match = /^\/workspace\/playlists\/([^/?#]+)/.exec(
            this.router.url
        );
        return match ? decodeURIComponent(match[1]) : null;
    }
}

type StalkerEnforcementModule =
    typeof import('./parental-lock-stalker-enforcement');

function hasPlayingAudio(): boolean {
    return Array.from(document.querySelectorAll('audio')).some(
        (audio) => !audio.paused && !audio.ended
    );
}
