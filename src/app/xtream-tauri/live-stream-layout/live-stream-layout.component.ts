import { ScrollingModule } from '@angular/cdk/scrolling';
import { NgIf } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    inject,
    OnInit,
    signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { TranslateModule } from '@ngx-translate/core';
import {
    OPEN_MPV_PLAYER,
    OPEN_VLC_PLAYER,
} from '../../../../shared/ipc-commands';
import { XtreamItem } from '../../../../shared/xtream-item.interface';
import { EpgViewComponent } from '../../portals/epg-view/epg-view.component';
import { WebPlayerViewComponent } from '../../portals/web-player-view/web-player-view.component';
import { DataService } from '../../services/data.service';
import { DatabaseService } from '../../services/database.service'; // Add this import
import { SettingsStore } from '../../services/settings-store.service';
import { VideoPlayer } from '../../settings/settings.interface';
import { ExternalPlayerInfoDialogComponent } from '../../shared/components/external-player-info-dialog/external-player-info-dialog.component';
import { FilterPipe } from '../../shared/pipes/filter.pipe';
import {
    PlayerDialogComponent,
    PlayerDialogData,
} from '../player-dialog/player-dialog.component';
import { FavoritesService } from '../services/favorites.service';
import { XtreamStore } from '../xtream.store';

@Component({
    standalone: true,
    selector: 'app-live-stream-layout',
    templateUrl: './live-stream-layout.component.html',
    styleUrls: ['./live-stream-layout.component.scss'],
    imports: [
        EpgViewComponent,
        FilterPipe,
        FormsModule,
        MatIconButton,
        MatListModule,
        MatIcon,
        MatInputModule,
        MatFormFieldModule,
        NgIf,
        ScrollingModule,
        WebPlayerViewComponent,
        TranslateModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveStreamLayoutComponent implements OnInit {
    private settingsStore = inject(SettingsStore);
    private dialog = inject(MatDialog);
    private dataService = inject(DataService);
    private favoritesService = inject(FavoritesService);
    private dbService = inject(DatabaseService); // Add this injection

    private readonly settings = this.settingsStore.getSettings();
    readonly xtreamStore = inject(XtreamStore);
    readonly channels = this.xtreamStore.liveStreams;
    readonly epgItems = this.xtreamStore.epgItems;
    private readonly hideExternalInfoDialog =
        this.xtreamStore.hideExternalInfoDialog;
    private readonly selectedContentType = this.xtreamStore.selectedContentType;

    player: VideoPlayer = VideoPlayer.VideoJs;
    streamUrl: string;
    searchString = signal<string>('');
    favorites = new Map<number, boolean>();

    trackBy(_index: number, item: XtreamItem) {
        return item.xtream_id;
    }

    ngOnInit() {
        const playlist = this.xtreamStore.currentPlaylist();
        if (playlist) {
            this.favoritesService
                .getFavorites(playlist.id)
                .subscribe((favorites) => {
                    // Map using content.id instead of xtream_id
                    favorites.forEach((fav: any) => {
                        this.favorites.set(fav.xtream_id, true);
                    });
                });
        }
    }

    playLive(item: any) {
        const { serverUrl, username, password } =
            this.xtreamStore.currentPlaylist();
        const streamUrl = `${serverUrl}/live/${username}/${password}/${item.xtream_id}.m3u8`;
        // TODO: offer option to select TS or m3u8
        this.openPlayer(streamUrl, item.title, item.poster_url);
        this.xtreamStore.setSelectedItem(item);
        this.xtreamStore.loadEpg();
    }

    openPlayer(streamUrl: string, title: string, thumbnail: string) {
        this.streamUrl = streamUrl;
        this.player = this.settings()?.player ?? VideoPlayer.VideoJs;
        if (this.player === VideoPlayer.MPV) {
            if (!this.hideExternalInfoDialog())
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            this.dataService.sendIpcEvent(OPEN_MPV_PLAYER, {
                url: streamUrl,
                mpvPlayerPath: this.settings()?.mpvPlayerPath,
                title,
                thumbnail,
            });
        } else if (this.player === VideoPlayer.VLC) {
            if (!this.hideExternalInfoDialog())
                this.dialog.open(ExternalPlayerInfoDialogComponent);
            this.dataService.sendIpcEvent(OPEN_VLC_PLAYER, {
                url: streamUrl,
                vlcPlayerPath: this.settings()?.vlcPlayerPath,
            });
        } else {
            if (this.selectedContentType() !== 'live') {
                this.dialog.open<PlayerDialogComponent, PlayerDialogData>(
                    PlayerDialogComponent,
                    {
                        data: { streamUrl, title },
                        width: '80%',
                    }
                );
            }
        }
    }

    async toggleFavorite(event: Event, item: any): Promise<void> {
        event.stopPropagation();
        const playlist = this.xtreamStore.currentPlaylist();

        // Update UI state immediately
        const currentFavoriteState =
            this.favorites.get(item.xtream_id) || false;
        this.favorites.set(item.xtream_id, !currentFavoriteState);

        try {
            const db = await this.dbService.getConnection();
            const content: any = await db.select(
                'SELECT id FROM content WHERE xtream_id = ?',
                [item.xtream_id]
            );

            if (!content || content.length === 0) {
                console.error('Content not found in database');
                // Revert UI state on error
                this.favorites.set(item.xtream_id, currentFavoriteState);
                return;
            }

            const contentId = content[0].id;

            if (!currentFavoriteState) {
                await this.favoritesService.addToFavorites({
                    content_id: contentId,
                    playlist_id: playlist.id,
                });
            } else {
                await this.favoritesService.removeFromFavorites(
                    contentId,
                    playlist.id
                );
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
            // Revert UI state on error
            this.favorites.set(item.xtream_id, currentFavoriteState);
        }
    }
}
