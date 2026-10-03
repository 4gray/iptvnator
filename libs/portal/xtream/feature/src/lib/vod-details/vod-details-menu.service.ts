import { computed, inject, Injectable, Signal, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import {
    createLogger,
    PORTAL_PLAYBACK_POSITIONS,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { RuntimeCapabilitiesService, SettingsStore } from '@iptvnator/services';
import {
    VideoPlayer,
    type ExternalPlayerName,
    type XtreamCategory,
    type XtreamVodDetails,
} from '@iptvnator/shared/interfaces';
import type { VodMoreMenuSection } from '@iptvnator/ui/components';
import { VodDetailsMultiSourceUiService } from './vod-details-multi-source-ui.service';
import { VodDetailsPlaybackService } from './vod-details-playback.service';
import { withoutVodResetTarget } from './vod-details-reset-target';
import { VodMultiSourceHostService } from './vod-multi-source-host.service';

export const VOD_MENU_ACTION = {
    Sources: 'sources',
    ExternalPlayer: 'external-player',
    CopyUrl: 'copy-url',
    StartOver: 'start-over',
    ResetProgress: 'reset-progress',
    ShowInCategory: 'show-in-category',
} as const;

interface VodDetailsMenuBindings {
    readonly item: Signal<XtreamVodDetails | null>;
    readonly vodId: Signal<number>;
    readonly category: Signal<Partial<XtreamCategory> | null>;
    /** Start over honours a pinned copy, so the host owns it. */
    readonly restart: () => Promise<void>;
    /** The MPV/VLC launch honours the pinned copy and its resume point too. */
    readonly openExternal: (player: ExternalPlayerName) => Promise<void>;
}

/**
 * The "…" menu of the Xtream movie page: which rows exist for this provider
 * and copy, and what each one does. Rows the provider cannot serve are left
 * out rather than disabled.
 */
@Injectable()
export class VodDetailsMenuService {
    private readonly xtreamStore = inject(XtreamStore);
    private readonly playback = inject(VodDetailsPlaybackService);
    private readonly msUi = inject(VodDetailsMultiSourceUiService);
    private readonly multiSource = inject(VodMultiSourceHostService);
    private readonly playbackPositions = inject(PORTAL_PLAYBACK_POSITIONS);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly router = inject(Router);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly logger = createLogger('VodDetailsMenu');
    private readonly bindings = signal<VodDetailsMenuBindings | null>(null);

    bind(bindings: VodDetailsMenuBindings): void {
        this.bindings.set(bindings);
    }

    /** MPV or VLC: the configured one, otherwise MPV. */
    readonly externalPlayer = computed<ExternalPlayerName>(() =>
        this.settingsStore.player() === VideoPlayer.VLC ? 'vlc' : 'mpv'
    );

    readonly sections = computed<VodMoreMenuSection[]>(() => {
        const item = this.bindings()?.item() ?? null;
        const category = this.bindings()?.category() ?? null;
        // The copy the primary button acts on: a pinned copy's own row.
        const started = this.msUi.primaryPosition() !== null;
        // A start still resolving, a launch still inside the player IPC or
        // a reset still writing: another start would be refused (or resume
        // from the row being cleared), so the row would mislead.
        const startPending =
            this.playback.playbackStartPending() ||
            this.playback.startBlocked();
        const sourceRows: VodMoreMenuSection['items'][number][] = [];
        if (this.multiSource.hasAlternatives()) {
            sourceRows.push({
                id: VOD_MENU_ACTION.Sources,
                labelKey: 'PORTALS.DETAIL.OTHER_SOURCES',
                icon: 'video_library',
                hint: this.multiSource.alternativeCount(),
                kind: 'sources',
                testId: 'vod-menu-sources',
            });
        }
        if (item && this.runtime.supportsManagedExternalPlayers) {
            sourceRows.push({
                id: VOD_MENU_ACTION.ExternalPlayer,
                labelKey: 'PORTALS.DETAIL.OPEN_IN_EXTERNAL_PLAYER',
                icon: 'open_in_new',
                hint: this.externalPlayer() === 'vlc' ? 'VLC' : 'MPV',
                disabled: startPending,
                testId: 'vod-menu-external',
            });
        }
        if (item) {
            sourceRows.push({
                id: VOD_MENU_ACTION.CopyUrl,
                labelKey: 'PORTALS.COPY_STREAM_URL',
                icon: 'link',
                testId: 'vod-menu-copy-url',
            });
        }
        const stateRows: VodMoreMenuSection['items'][number][] = [];
        if (item && this.msUi.hasPlaybackPosition()) {
            stateRows.push({
                id: VOD_MENU_ACTION.StartOver,
                labelKey: 'XTREAM.RESTART',
                icon: 'replay',
                disabled: startPending,
                testId: 'vod-menu-start-over',
            });
        }
        if (started) {
            stateRows.push({
                id: VOD_MENU_ACTION.ResetProgress,
                labelKey: 'PORTALS.DETAIL.RESET_PROGRESS',
                icon: 'history_toggle_off',
                // A running player would write the position right back.
                disabled:
                    this.playback.isExternalStopAction() ||
                    this.playback.playbackStartPending() ||
                    this.playback.resetPending() ||
                    this.playback.inlinePlayback() !== null,
                testId: 'vod-menu-reset-progress',
            });
        }
        if (category?.category_id) {
            stateRows.push({
                id: VOD_MENU_ACTION.ShowInCategory,
                labelKey: 'PORTALS.DETAIL.SHOW_IN_CATEGORY',
                icon: 'folder_open',
                hint: category.category_name ?? null,
                testId: 'vod-menu-show-in-category',
            });
        }
        return [{ items: sourceRows }, { items: stateRows }];
    });

    async run(actionId: string): Promise<void> {
        const item = this.bindings()?.item() ?? null;
        switch (actionId) {
            case VOD_MENU_ACTION.ExternalPlayer:
                await this.bindings()?.openExternal(this.externalPlayer());
                return;
            case VOD_MENU_ACTION.CopyUrl:
                await this.copyStreamUrl(item);
                return;
            case VOD_MENU_ACTION.StartOver:
                await this.bindings()?.restart();
                return;
            case VOD_MENU_ACTION.ResetProgress:
                await this.resetProgress();
                return;
            case VOD_MENU_ACTION.ShowInCategory:
                this.showInCategory();
                return;
        }
    }

    private async copyStreamUrl(item: XtreamVodDetails | null): Promise<void> {
        if (!item) {
            return;
        }
        try {
            await navigator.clipboard.writeText(
                this.xtreamStore.constructVodStreamUrl(item)
            );
            this.notify('PORTALS.STREAM_URL_COPIED');
        } catch (error) {
            this.logger.warn('Copying the stream URL failed', error);
            this.notify('DOWNLOADS.URL_COPY_FAILED');
        }
    }

    /**
     * Clears the saved position of the copy the primary button acts on (a
     * pinned copy has its own row): the next Play starts from the beginning.
     */
    private async resetProgress(): Promise<void> {
        const target = this.msUi.primaryTarget();
        if (!target) {
            return;
        }
        const { playlistId, contentId } = target;
        // Every start of this copy is refused until the write landed: one
        // made meanwhile would resume from the very row being cleared.
        this.playback.pendingResets.update((pending) => [...pending, target]);
        try {
            await this.playbackPositions.clearPlaybackPositionOrThrow(
                playlistId,
                contentId,
                'vod'
            );
        } catch (error) {
            this.logger.error('Resetting the playback position failed', error);
            return;
        } finally {
            // Only this reset's entry: another copy's, or an overlapping
            // reset of the same copy, keeps holding its starts.
            this.playback.pendingResets.update((pending) =>
                withoutVodResetTarget(pending, target)
            );
        }
        // The clear was async: the route may show another movie by now
        // (the Similar rail reuses it), or the pin may have moved, and that
        // state must stay.
        const current = this.msUi.primaryTarget();
        if (
            current?.playlistId !== playlistId ||
            current.contentId !== contentId
        ) {
            // Another movie of the same playlist still gets fresh store
            // badges; another playlist's store must not be replaced by the
            // old playlist's positions.
            if (this.xtreamStore.currentPlaylist()?.id === playlistId) {
                void this.xtreamStore.loadAllPositions(playlistId);
            }
            return;
        }
        // A read still in flight started from the pre-write row; letting it
        // land would bring the position back.
        if (this.msUi.primaryIsPinnedCopy()) {
            this.msUi.forgetPinnedPosition();
        } else {
            this.playback.discardPendingPositionLoads();
            this.playback.routePlaybackPosition.set(null);
        }
        this.playback.vodPlaybackPosition.set(null);
        if (this.xtreamStore.currentPlaylist()?.id === playlistId) {
            void this.xtreamStore.loadAllPositions(playlistId);
        }
        this.notify('PORTALS.DETAIL.PROGRESS_RESET');
    }

    private showInCategory(): void {
        const playlistId = this.xtreamStore.currentPlaylist()?.id;
        const categoryId = this.bindings()?.category()?.category_id;
        if (!playlistId || categoryId === undefined || categoryId === null) {
            return;
        }
        void this.router.navigate([
            '/workspace/xtreams',
            playlistId,
            'vod',
            String(categoryId),
        ]);
    }

    private notify(key: string): void {
        this.snackBar.open(this.translate.instant(key), undefined, {
            duration: 3000,
        });
    }
}
