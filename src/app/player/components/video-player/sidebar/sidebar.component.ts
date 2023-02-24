import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Channel } from '../../../../../../shared/channel.interface';
import { DataService } from '../../../../services/data.service';
import * as PlaylistActions from '../../../../state/actions';
import { selectPlaylistTitle } from '../../../../state/selectors';
import { SidebarView } from '../video-player.component';

@Component({
    selector: 'app-sidebar',
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
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
