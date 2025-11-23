import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { map, switchMap } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import { PlaylistsService } from '../../../services/playlists.service';
import { DataService } from '../../../services/data.service';
import { CHANNEL_SET_USER_AGENT } from '../../../../../shared/ipc-commands';
import * as PlaylistActions from '../../../state/actions';
import { NetflixGridComponent } from '../netflix-grid/netflix-grid.component';
import { ChannelListContainerComponent } from '../channel-list-container/channel-list-container.component';

@Component({
    selector: 'app-netflix-view',
    templateUrl: './netflix-view.component.html',
    styleUrls: ['./netflix-view.component.scss'],
    imports: [
        CommonModule,
        NetflixGridComponent,
        ChannelListContainerComponent,
        MatButtonToggleModule,
        MatIconModule,
        TranslatePipe,
    ],
})
export class NetflixViewComponent implements OnInit, OnDestroy {
    channels: Channel[] = [];
    isLoading = true;
    viewMode: 'list' | 'grid' = 'grid';

    constructor(
        private activatedRoute: ActivatedRoute,
        private dataService: DataService,
        private playlistsService: PlaylistsService,
        private store: Store
    ) {}

    ngOnInit(): void {
        this.activatedRoute.params
            .pipe(
                switchMap((params) => {
                    if (params['id']) {
                        // Set active playlist in store
                        this.store.dispatch(
                            PlaylistActions.setActivePlaylist({
                                playlistId: params['id'],
                            })
                        );

                        // Load playlist and get channels
                        return this.playlistsService.getPlaylist(params['id']).pipe(
                            map((playlist) => {
                                // Set user agent if available
                                if (playlist.userAgent) {
                                    this.dataService.sendIpcEvent(
                                        CHANNEL_SET_USER_AGENT,
                                        {
                                            referer: 'localhost',
                                            userAgent: playlist.userAgent,
                                        }
                                    );
                                }

                                // Dispatch channels to store
                                this.store.dispatch(
                                    PlaylistActions.setChannels({
                                        channels: playlist.playlist.items,
                                    })
                                );

                                return playlist.playlist.items as Channel[];
                            })
                        );
                    }
                    return [];
                })
            )
            .subscribe({
                next: (channels) => {
                    this.channels = channels;
                    this.isLoading = false;
                },
                error: (error) => {
                    console.error('Error loading playlist:', error);
                    this.isLoading = false;
                },
            });
    }

    ngOnDestroy(): void {
        // Cleanup if needed
    }

    setViewMode(mode: 'list' | 'grid'): void {
        this.viewMode = mode;
    }
}

