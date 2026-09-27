import {
    effect,
    EnvironmentInjector,
    inject,
    Injectable,
    untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { ChannelActions, selectActive } from '@iptvnator/m3u-state';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
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
    private readonly injector = inject(EnvironmentInjector);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly keepAwake = inject(PlaybackKeepAwakeService);
    private readonly activeChannel = this.store.selectSignal(selectActive);
    private started = false;
    private lastVersion = -1;
    private applyChain: Promise<void> = Promise.resolve();

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
        effect(() => {
            const version = this.parentalLock.version();
            untracked(() => {
                if (version === this.lastVersion) {
                    return;
                }
                const first = this.lastVersion === -1;
                this.lastVersion = version;
                if (!first) {
                    this.scheduleApply();
                }
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
        const shouldPublish = (): boolean =>
            this.parentalLock.version() === version;
        const match = XTREAM_ROUTE.exec(this.router.url);
        if (this.parentalLock.active()) {
            // Relock: fail closed NOW, not after the database answers. The
            // selected detail is judged against the lock store while the
            // pre-reload category list can still map its category; the
            // catalog lists and stored search results are emptied and
            // refilled by the filtered reads below.
            this.stepOffLockedXtreamSelection(playlistId, match);
            this.xtreamStore.withholdCatalog?.();
            this.xtreamStore.clearSearchResults?.();
        }
        await this.xtreamStore.reloadCategories(shouldPublish);
        await this.xtreamStore.reloadCachedContent(shouldPublish);
        if (!shouldPublish()) {
            return;
        }
        // Stored in-portal search results are a separate array the search
        // page renders directly; re-run the search so it reads filtered.
        await this.xtreamStore.refreshSearchResults?.();
        if (!shouldPublish()) {
            return;
        }

        const categoryType = toParentalLockXtreamCategoryType(match?.[2]);
        const categories = this.xtreamStore.getCategoriesBySelectedType();
        const isVisibleCategory = (categoryId: unknown): boolean =>
            categories.some(
                (category) =>
                    Number(
                        (category as { id?: number | string }).id ??
                            (category as { category_id?: string }).category_id
                    ) === Number(categoryId)
            );
        const selectedCategoryId = this.xtreamStore.selectedCategoryId();
        // The selected ITEM is judged on its own category: opened from
        // "All", recently added or search it has no selected category to
        // vanish with, yet its detail must not outlive the lock.
        const selectedItem = this.xtreamStore.selectedItem?.() as {
            category_id?: string | number;
        } | null;
        const itemWithheld =
            selectedItem?.category_id !== undefined &&
            selectedItem?.category_id !== null &&
            !isVisibleCategory(selectedItem.category_id);
        if (itemWithheld) {
            this.xtreamStore.setSelectedItem(null);
        }
        if (
            selectedCategoryId === null ||
            isVisibleCategory(selectedCategoryId)
        ) {
            if (itemWithheld && match && match[1] === playlistId) {
                void this.router.navigate([
                    '/workspace',
                    'xtreams',
                    match[1],
                    match[2],
                ]);
            }
            return;
        }
        this.xtreamStore.setSelectedItem(null);
        this.xtreamStore.setSelectedCategory(null);
        if (match && match[1] === playlistId && categoryType) {
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
     * keyed by, the PWA carries the provider id directly. An item that
     * cannot be placed is left to the post-reload check.
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
            !Number.isFinite(providerId) ||
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
    loadStalkerEnforcement = () =>
        import('./parental-lock-stalker-enforcement');

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
        const { applyParentalLockToStalker } =
            await this.loadStalkerEnforcement();
        applyParentalLockToStalker(
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

function hasPlayingAudio(): boolean {
    return Array.from(document.querySelectorAll('audio')).some(
        (audio) => !audio.paused && !audio.ended
    );
}
