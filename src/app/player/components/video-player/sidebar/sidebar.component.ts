import { AsyncPipe, NgIf } from '@angular/common';
import { Component, Input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { Channel } from '../../../../../../shared/channel.interface';
import { RecentPlaylistsComponent } from '../../../../home/recent-playlists/recent-playlists.component';
import { DataService } from '../../../../services/data.service';
import * as PlaylistActions from '../../../../state/actions';
import { selectPlaylistTitle } from '../../../../state/selectors';
import { SidebarView } from '../video-player.component';
import { ChannelListContainerComponent } from './../../channel-list-container/channel-list-container.component';
@Component({
    standalone: true,
    selector: 'app-sidebar',
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
    imports: [
        AsyncPipe,
        ChannelListContainerComponent,
        MatButtonModule,
        MatDividerModule,
        MatIconModule,
        MatTooltipModule,
        NgIf,
        RecentPlaylistsComponent,
        TranslateModule,
        RouterLink,
    ],
})
export class SidebarComponent {
    @Input() channels: Channel[] = [];

    isElectron = this.dataService.isElectron;

    playlistTitle$ = this.store.select(selectPlaylistTitle);

    sidebarView: SidebarView = 'CHANNELS';

    constructor(
        public dataService: DataService,
        private router: Router,
        private store: Store
    ) {}

    goBack(): void {
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
