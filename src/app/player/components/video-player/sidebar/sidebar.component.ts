import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { Channel } from '../../../../../../shared/channel.interface';
import { RecentPlaylistsComponent } from '../../../../home/recent-playlists/recent-playlists.component';
import * as PlaylistActions from '../../../../state/actions';
import { selectPlaylistTitle } from '../../../../state/selectors';
import { SidebarView } from '../video-player.component';
import { ChannelListContainerComponent } from './../../channel-list-container/channel-list-container.component';
@Component({
    selector: 'app-sidebar',
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
    imports: [
        AsyncPipe,
        ChannelListContainerComponent,
        MatIcon,
        MatIconButton,
        MatTooltip,
        RecentPlaylistsComponent,
        RouterLink,
        TranslatePipe,
    ],
})
export class SidebarComponent {
    readonly channels = input<Channel[]>([]);

    private readonly router = inject(Router);
    private readonly store = inject(Store);

    readonly playlistTitle$ = this.store.select(selectPlaylistTitle);
    sidebarView: SidebarView = 'CHANNELS';

    goBack() {
        if (this.sidebarView === 'PLAYLISTS') {
            this.store.dispatch(PlaylistActions.resetActiveChannel());
            this.router.navigate(['/']);
        } else {
            this.sidebarView = 'PLAYLISTS';
        }
    }

    selectPlaylist() {
        this.sidebarView = 'CHANNELS';
    }
}
