import { effect, inject, Injectable, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { ChannelActions, selectActive } from '@iptvnator/m3u-state';
import { StalkerStore } from '@iptvnator/portal/stalker/data-access';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';
import {
    toParentalLockStalkerCategoryType,
    toParentalLockXtreamCategoryType,
} from '@iptvnator/shared/interfaces';
import { PlaybackKeepAwakeService } from './playback-keep-awake.service';

const XTREAM_ROUTE =
    /^\/workspace\/xtreams\/([^/?#]+)\/(live|vod|series)(?:\/(\d+))?/;
const STALKER_ROUTE =
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
    private readonly stalkerStore = inject(StalkerStore);
    private readonly router = inject(Router);
    private readonly store = inject(Store);
    private readonly keepAwake = inject(PlaybackKeepAwakeService);
    private readonly activeChannel = this.store.selectSignal(selectActive);
    private started = false;
    private lastVersion = -1;

    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        this.parentalLock.registerBusyProbe(() =>
            this.keepAwake.hasPlayingVideo()
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
                    void this.apply();
                }
            });
        });
    }

    private async apply(): Promise<void> {
        await Promise.all([this.applyXtream(), this.applyStalker()]);
        this.applyM3u();
    }

    private async applyXtream(): Promise<void> {
        const playlistId = this.xtreamStore.playlistId?.();
        if (!playlistId) {
            return;
        }
        await this.xtreamStore.reloadCategories();
        await this.xtreamStore.reloadCachedContent();

        const match = XTREAM_ROUTE.exec(this.router.url);
        const selectedCategoryId = this.xtreamStore.selectedCategoryId();
        if (selectedCategoryId === null) {
            return;
        }
        const categoryType = toParentalLockXtreamCategoryType(match?.[2]);
        const categories = this.xtreamStore.getCategoriesBySelectedType();
        const stillVisible = categories.some(
            (category) =>
                Number(
                    (category as { id?: number | string }).id ??
                        (category as { category_id?: string }).category_id
                ) === Number(selectedCategoryId)
        );
        if (stillVisible) {
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

    private async applyStalker(): Promise<void> {
        const playlist = this.stalkerStore.currentPlaylist();
        const playlistId = playlist?._id;
        if (!playlistId) {
            return;
        }
        const contentType = toParentalLockStalkerCategoryType(
            this.stalkerStore.selectedContentType()
        );
        const selectedCategoryId = this.stalkerStore.selectedCategoryId();
        if (
            !contentType ||
            !selectedCategoryId ||
            !this.parentalLock.isStalkerCategoryLocked(
                playlistId,
                contentType,
                selectedCategoryId
            )
        ) {
            return;
        }
        this.stalkerStore.clearSelectedItem();
        this.stalkerStore.setSelectedCategory(null);
        const match = STALKER_ROUTE.exec(this.router.url);
        if (match && match[1] === playlistId) {
            void this.router.navigate([
                '/workspace',
                'stalker',
                match[1],
                match[2],
            ]);
        }
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
