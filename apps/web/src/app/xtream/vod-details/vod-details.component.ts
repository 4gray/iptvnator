import {
    Component,
    computed,
    inject,
    input,
    output,
    OnDestroy,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { ContentHeroComponent } from 'components';
import {
    VodDetailsItem,
    normalizeVodDetails,
    getVodNumericId,
} from 'shared-interfaces';
import { DownloadsService } from '../../services/downloads.service';
import { SafePipe } from '@iptvnator/pipes';
import { StalkerStore } from '../../stalker/stalker.store';

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
    styleUrls: ['../../xtream-tauri/detail-view.scss'],
    imports: [
        ContentHeroComponent,
        MatIcon,
        MatProgressSpinnerModule,
        SafePipe,
        TranslatePipe,
    ],
})
export class VodDetailsComponent implements OnDestroy {
    // ============ Inputs ============

    /** VOD item with discriminated union type */
    readonly item = input.required<VodDetailsItem>();

    /** Whether this item is in favorites (managed by parent) */
    readonly isFavorite = input<boolean>(false);

    /** Playback position in seconds for resume feature (managed by parent) */
    readonly playbackPosition = input<number | null>(null);

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

    // ============ Services ============

    private readonly downloadsService = inject(DownloadsService);
    private readonly stalkerStore = inject(StalkerStore);

    // ============ Computed State ============

    /** Whether running in Electron (downloads available) */
    readonly isElectron = this.downloadsService.isAvailable;

    /** Normalized metadata for display */
    readonly normalizedMeta = computed(() => {
        return normalizeVodDetails(this.item());
    });

    /** Whether item is from Stalker portal */
    readonly isStalkerItem = computed(() => this.item().type === 'stalker');

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

    // ============ Lifecycle ============

    ngOnDestroy(): void {
        // Clear selected item when leaving Stalker mode
        if (this.isStalkerItem()) {
            this.stalkerStore.clearSelectedItem();
        }
    }

    // ============ Actions ============

    /** Handle play button click */
    onPlay(): void {
        this.playClicked.emit(this.item());
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
