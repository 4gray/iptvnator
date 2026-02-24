import { Component, computed, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { selectPlaylistTitle } from 'm3u-state';
import { Channel } from 'shared-interfaces';
import { PlaylistSwitcherComponent } from '../../playlist-switcher/playlist-switcher.component';
import { ChannelListContainerComponent } from './../../channel-list-container/channel-list-container.component';

@Component({
    selector: 'app-sidebar',
    templateUrl: './sidebar.component.html',
    styleUrls: ['./sidebar.component.scss'],
    imports: [
        ChannelListContainerComponent,
        MatIcon,
        MatIconButton,
        MatTooltip,
        PlaylistSwitcherComponent,
        RouterLink,
        TranslatePipe,
    ],
})
export class SidebarComponent {
    readonly channels = input<Channel[]>([]);
    readonly showPlaylistHeader = input(true);

    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);

    readonly playlistTitle = this.store.selectSignal(selectPlaylistTitle);

    readonly subtitle = computed(() => {
        const count = this.channels()?.length ?? 0;
        return `${count} ${this.translate.instant('HOME.PLAYLISTS.CHANNELS')}`;
    });
}
