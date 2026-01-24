import { Location, SlicePipe } from '@angular/common';
import {
    Component,
    EventEmitter,
    Input,
    OnInit,
    Output,
    inject,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ContentHeroComponent } from 'components';
import { PlaylistsService } from 'services';
import { XtreamVodDetails } from 'shared-interfaces';
import { StalkerStore } from '../../stalker/stalker.store';
import { SafePipe } from '../../xtream-tauri/vod-details/safe.pipe';
import { DownloadsService } from '../../services/downloads.service';

@Component({
    selector: 'app-vod-details',
    templateUrl: './vod-details.component.html',
    styleUrls: ['../../xtream-tauri/detail-view.scss'],
    imports: [
        ContentHeroComponent,
        MatIcon,
        MatProgressSpinnerModule,
        SafePipe,
        SlicePipe,
        TranslatePipe,
    ],
})
export class VodDetailsComponent implements OnInit {
    @Input({ required: true }) item: XtreamVodDetails;

    @Output() addToFavoritesClicked = new EventEmitter<any>();
    @Output() playClicked = new EventEmitter<XtreamVodDetails>();
    @Output() removeFromFavoritesClicked = new EventEmitter<number>();
    @Output() backClicked = new EventEmitter<void>();

    private location = inject(Location);
    private playlistService = inject(PlaylistsService);
    private route = inject(ActivatedRoute);
    private stalkerStore = inject(StalkerStore);
    private readonly downloadsService = inject(DownloadsService);
    private portalId =
        this.route.snapshot.paramMap.get('id') ??
        this.route.parent.snapshot.params.id;

    /**
     * Check if this is a Stalker item
     * Uses both cmd property check and stalkerStore playlist to be more reliable
     */
    private get isStalker(): boolean {
        const hasCmd = !!(this.item as any)?.cmd;
        const hasStalkerPlaylist = !!(
            this.stalkerStore.currentPlaylist()?.portalUrl &&
            this.stalkerStore.currentPlaylist()?.macAddress
        );
        return hasCmd || hasStalkerPlaylist;
    }

    /**
     * Get the correct playlist ID based on mode
     * Stalker uses _id, Xtream uses portalId from route
     */
    private getPlaylistIdForDownloads(): string | null {
        if (this.isStalker) {
            return this.stalkerStore.currentPlaylist()?._id || null;
        }
        return this.portalId;
    }

    /** Whether downloads are available (Electron only) */
    get isElectron(): boolean {
        return this.downloadsService.isAvailable();
    }

    isFavorite = false;
    isLoading = false;

    ngOnInit(): void {
        this.checkFavoriteStatus();
    }

    checkFavoriteStatus() {
        this.playlistService
            .getPortalFavorites(this.portalId)
            .subscribe((favorites) => {
                if (!favorites || favorites.length === 0) {
                    this.isFavorite = false;
                } else {
                    this.isFavorite = favorites.some((i) => {
                        const hasStreamId =
                            i?.stream_id !== undefined &&
                            this.item?.movie_data?.stream_id !== undefined;
                        const hasId =
                            (i as any)?.details?.id !== undefined &&
                            (this.item as any)?.id !== undefined;

                        return (
                            (hasStreamId &&
                                i.stream_id ===
                                    this.item.movie_data.stream_id) ||
                            (hasId &&
                                (i as any).details.id === (this.item as any).id)
                        );
                    });
                }
            });
    }

    toggleFavorite() {
        if (this.isFavorite) {
            this.removeFromFavoritesClicked.emit(
                this.item?.movie_data?.stream_id || (this.item as any)?.id
            );
        } else {
            // stalker mode
            if ((this.item as any).cmd) {
                this.addToFavoritesClicked.emit({
                    name: this.item.info.name,
                    stream_id: (this.item as any).id,
                    cover: this.item.info.movie_image,
                    cmd: (this.item as any).cmd || '',
                    details: this.item,
                });
            } else {
                this.addToFavoritesClicked.emit({
                    name: this.item.movie_data.name,
                    stream_id: this.item.movie_data.stream_id,
                    container_extension:
                        this.item.movie_data.container_extension,
                    cover: this.item.info.movie_image,
                    stream_type: 'movie',
                });
            }
        }
        this.isFavorite = !this.isFavorite;
    }

    goBack() {
        this.backClicked.emit();
        if (this.isStalker) {
            // Stalker mode: clear selectedItem to return to category view
            this.stalkerStore.clearSelectedItem();
        } else {
            // Xtream mode: use browser history navigation
            this.location.back();
        }
    }

    /** Check if VOD is already downloaded */
    get isDownloaded(): boolean {
        const vodId = this.getVodId();
        const playlistId = this.getPlaylistIdForDownloads();
        if (!vodId || !playlistId) return false;
        // Access downloads signal to make this reactive
        this.downloadsService.downloads();
        return this.downloadsService.isDownloaded(vodId, playlistId, 'vod');
    }

    /** Check if VOD is currently downloading */
    get isDownloading(): boolean {
        const vodId = this.getVodId();
        const playlistId = this.getPlaylistIdForDownloads();
        if (!vodId || !playlistId) return false;
        // Access downloads signal to make this reactive
        this.downloadsService.downloads();
        return this.downloadsService.isDownloading(vodId, playlistId, 'vod');
    }

    /** Get VOD ID from item */
    private getVodId(): number | null {
        if (this.isStalker) {
            return Number((this.item as any)?.id) || null;
        }
        return Number(this.item?.movie_data?.stream_id) || null;
    }

    /** Get stream URL for download */
    private getStreamUrl(): string | null {
        if (this.isStalker) {
            // For Stalker, the stream URL is in the cmd property
            return (this.item as any)?.cmd || null;
        }
        // For Xtream, construct the URL from playlist info
        const playlist = this.stalkerStore.currentPlaylist();
        if (!playlist) return null;

        const serverUrl = playlist.serverUrl?.replace(/\/$/, '') || '';
        const username = playlist.username || '';
        const password = playlist.password || '';
        const streamId = this.item?.movie_data?.stream_id;
        const extension = this.item?.movie_data?.container_extension || 'mp4';

        if (!streamId) return null;
        return `${serverUrl}/movie/${username}/${password}/${streamId}.${extension}`;
    }

    /** Download VOD */
    async downloadVod() {
        const vodId = this.getVodId();
        if (!vodId) return;

        const playlistId = this.getPlaylistIdForDownloads();
        if (!playlistId) {
            console.error('[VodDetails] No playlist ID available');
            return;
        }

        let url: string;

        if (this.isStalker) {
            // For Stalker, resolve the actual stream URL via the API
            const playlist = this.stalkerStore.currentPlaylist();
            const cmd = (this.item as any)?.cmd;
            if (!cmd || !playlist?.portalUrl || !playlist?.macAddress) {
                console.error('[VodDetails] Missing Stalker data: cmd, portalUrl, or macAddress');
                return;
            }

            try {
                url = await this.stalkerStore.fetchLinkToPlay(
                    playlist.portalUrl,
                    playlist.macAddress,
                    cmd
                );
                if (!url) {
                    console.error('[VodDetails] Failed to resolve Stalker stream URL');
                    return;
                }
            } catch (error) {
                console.error('[VodDetails] Error resolving Stalker stream URL:', error);
                return;
            }

            await this.downloadsService.startDownload({
                playlistId,
                xtreamId: vodId,
                contentType: 'vod',
                title: this.item?.info?.name || 'Unknown',
                url,
                posterUrl: this.item?.info?.movie_image,
                headers: {
                    userAgent: playlist?.userAgent,
                    referer: playlist?.referrer,
                    origin: playlist?.origin,
                },
                // Playlist info for auto-creation (Stalker playlists)
                playlistName: playlist?.title || 'Stalker Portal',
                playlistType: 'stalker',
                portalUrl: playlist?.portalUrl,
                macAddress: playlist?.macAddress,
            });
        } else {
            // For Xtream, construct the URL from playlist info
            const streamUrl = this.getStreamUrl();
            if (!streamUrl) return;
            url = streamUrl;

            await this.downloadsService.startDownload({
                playlistId,
                xtreamId: vodId,
                contentType: 'vod',
                title: this.item?.info?.name || 'Unknown',
                url,
                posterUrl: this.item?.info?.movie_image,
            });
        }
    }

    /** Play from local file */
    async playFromLocal() {
        const vodId = this.getVodId();
        const playlistId = this.getPlaylistIdForDownloads();
        if (!vodId || !playlistId) return;

        const filePath = this.downloadsService.getDownloadedFilePath(
            vodId,
            playlistId,
            'vod'
        );

        if (filePath) {
            await this.downloadsService.playDownload(filePath);
        }
    }
}
