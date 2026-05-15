import {
    Component,
    computed,
    inject,
    input,
    output,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { SafePipe } from '@iptvnator/pipes';
import { PORTAL_EXTERNAL_PLAYBACK } from '@iptvnator/portal/shared/util';
import { ContentHeroComponent } from '@iptvnator/ui/components';
import {
    ExternalPlayerSession,
    ResolvedPortalPlayback,
    VodDetailsItem,
    getVodNumericId,
    normalizeVodDetails,
} from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
import type { PlaybackFallbackRequest } from '../playback-diagnostics/playback-diagnostics.util';
import { PortalInlinePlayerComponent } from '../portal-inline-player/portal-inline-player.component';

/**
 * Unified VOD details component for both Xtream and Stalker portals.
 *
 * Uses discriminated union (VodDetailsItem) for type-safe handling.
 * All actions are emitted as outputs - parent components handle
 * store-specific operations (play, favorites, downloads).
 *
 * @example
 * ```html
 * <app-vod-details
 *   [item]="vodItem"
 *   [isFavorite]="isFavorite()"
 *   [playbackPosition]="position()"
 *   (playClicked)="onPlay($event)"
 *   (resumeClicked)="onResume($event)"
 *   (favoriteToggled)="onToggleFavorite($event)"
 * />
 * ```
 */
@Component({
    selector: 'app-vod-details',
    templateUrl: './vod-details.component.html',
    styleUrls: ['../styles/detail-view.scss'],
    imports: [
        ContentHeroComponent,
        MatIcon,
        PortalInlinePlayerComponent,
        SafePipe,
        TranslatePipe,
    ],
})
export class VodDetailsComponent {
    // ============ Inputs ============

    /** VOD item with discriminated union type */
    readonly item = input.required<VodDetailsItem>();

    /** Whether this item is in favorites (managed by parent) */
    readonly isFavorite = input<boolean>(false);

    /** Playback position in seconds for resume feature (managed by parent) */
    readonly playbackPosition = input<number | null>(null);

    /** Inline playback payload for embedded players (managed by parent) */
    readonly inlinePlayback = input<ResolvedPortalPlayback | null>(null);

    /** Active external playback session for launch state */
    readonly externalPlayback = input<ExternalPlayerSession | null>(null);

    // ============ Outputs ============

    /** Emitted when play button is clicked */
    readonly playClicked = output<VodDetailsItem>();

    /** Emitted when resume button is clicked (includes position) */
    readonly resumeClicked = output<{ item: VodDetailsItem; positionSeconds: number }>();

    /** Emitted when favorite toggle is clicked */
    readonly favoriteToggled = output<{ item: VodDetailsItem; isFavorite: boolean }>();

    /** Emitted when back button is clicked */
    readonly backClicked = output<void>();

    /** Emitted when download is requested (parent handles URL construction) */
    readonly downloadRequested = output<VodDetailsItem>();

    /** Emitted when inline playback position changes */
    readonly inlineTimeUpdated = output<{
        currentTime: number;
        duration: number;
    }>();

    /** Emitted when the inline player should be closed */
    readonly inlinePlaybackClosed = output<void>();

    /** Emitted when the stream url is copied */
    readonly streamUrlCopied = output<void>();

    /** Emitted when the inline player requests MPV/VLC fallback */
    readonly inlineExternalFallbackRequested =
        output<PlaybackFallbackRequest>();

    // ============ Services ============

    private readonly downloadsService = inject(DownloadsService);
    private readonly externalPlaybackActions = inject(PORTAL_EXTERNAL_PLAYBACK);

    // ============ Computed State ============

    /** Whether running in Electron (downloads available) */
    readonly isElectron = computed(() => this.downloadsService.isAvailable());

    /** Normalized metadata for display */
    readonly normalizedMeta = computed(() => {
        return normalizeVodDetails(this.item());
    });

    /** Whether there's a playback position to resume from */
    readonly hasPlaybackPosition = computed(() => {
        const pos = this.playbackPosition();
        return pos !== null && pos > 0;
    });

    /** Formatted playback position (e.g., "12:34" or "1:23:45") */
    readonly formattedPosition = computed(() => {
        const pos = this.playbackPosition();
        if (!pos || pos <= 0) return '';

        const hours = Math.floor(pos / 3600);
        const minutes = Math.floor((pos % 3600) / 60);
        const seconds = Math.floor(pos % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    });

    /** Whether VOD is already downloaded */
    readonly isDownloaded = computed(() => {
        const item = this.item();
        // Access signal to create reactive dependency
        this.downloadsService.downloads();
        const vodId = getVodNumericId(item);
        return this.downloadsService.isDownloaded(vodId, item.playlistId, 'vod');
    });

    /** Whether VOD is currently downloading */
    readonly isDownloading = computed(() => {
        const item = this.item();
        // Access signal to create reactive dependency
        this.downloadsService.downloads();
        const vodId = getVodNumericId(item);
        return this.downloadsService.isDownloading(vodId, item.playlistId, 'vod');
    });

    readonly matchedExternalPlayback = computed(() => {
        const session = this.externalPlayback();
        const item = this.item();
        if (
            !session?.contentInfo ||
            session.status === 'closed' ||
            session.status === 'error'
        ) {
            return null;
        }

        const contentInfo = session.contentInfo;
        if (
            contentInfo.playlistId !== item.playlistId ||
            contentInfo.contentType !== 'vod' ||
            contentInfo.contentXtreamId !== getVodNumericId(item)
        ) {
            return null;
        }

        return session;
    });

    readonly externalPrimaryLabel = computed(() => {
        const session = this.matchedExternalPlayback();
        if (!session) {
            return null;
        }

        const player = session.player.toUpperCase();
        switch (session.status) {
            case 'launching':
                return `Opening in ${player}...`;
            case 'opened':
            case 'playing':
                return `Stop ${player}`;
            default:
                return null;
        }
    });

    readonly externalPrimaryIcon = computed(() => {
        const session = this.matchedExternalPlayback();
        switch (session?.status) {
            case 'launching':
                return 'hourglass_top';
            case 'opened':
            case 'playing':
                return 'stop_circle';
            default:
                return 'play_arrow';
        }
    });

    readonly isExternalLaunchPending = computed(
        () => this.matchedExternalPlayback()?.status === 'launching'
    );

    readonly isExternalStopAction = computed(() => {
        const status = this.matchedExternalPlayback()?.status;
        return status === 'opened' || status === 'playing';
    });

    readonly externalPrimaryButtonState = computed(() => {
        if (this.isExternalLaunchPending()) {
            return 'launching';
        }

        return this.isExternalStopAction() ? 'stop' : 'idle';
    });

    // ============ Actions ============

    /** Handle play button click */
    onPlay(): void {
        this.playClicked.emit(this.item());
    }

    onPrimaryAction(): void {
        if (this.isExternalStopAction()) {
            void this.stopExternalPlayback();
            return;
        }

        if (this.hasPlaybackPosition()) {
            this.onResume();
            return;
        }

        this.onPlay();
    }

    /** Handle resume button click */
    onResume(): void {
        const pos = this.playbackPosition();
        if (pos && pos > 0) {
            this.resumeClicked.emit({
                item: this.item(),
                positionSeconds: pos,
            });
        }
    }

    /** Handle favorite toggle - emits the desired new state */
    toggleFavorite(): void {
        this.favoriteToggled.emit({
            item: this.item(),
            isFavorite: !this.isFavorite(),
        });
    }

    /** Handle back navigation - emit event for parent to handle */
    goBack(): void {
        this.backClicked.emit();
    }

    /** Handle download request */
    onDownload(): void {
        this.downloadRequested.emit(this.item());
    }

    onInlineTimeUpdate(event: {
        currentTime: number;
        duration: number;
    }): void {
        this.inlineTimeUpdated.emit(event);
    }

    closeInlinePlayback(): void {
        this.inlinePlaybackClosed.emit();
    }

    onStreamUrlCopied(): void {
        this.streamUrlCopied.emit();
    }

    onInlineExternalFallbackRequested(
        request: PlaybackFallbackRequest
    ): void {
        this.inlineExternalFallbackRequested.emit(request);
    }

    async stopExternalPlayback(): Promise<void> {
        await this.externalPlaybackActions.closeSession(
            this.matchedExternalPlayback()
        );
    }

    /** Play from local downloaded file */
    async playFromLocal(): Promise<void> {
        const item = this.item();
        const vodId = getVodNumericId(item);

        const filePath = this.downloadsService.getDownloadedFilePath(
            vodId,
            item.playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }
}
