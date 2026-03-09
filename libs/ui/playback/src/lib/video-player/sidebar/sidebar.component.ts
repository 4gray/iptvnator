import { Component, computed, inject, input } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PlaylistSwitcherComponent } from '@iptvnator/playlist/shared/ui';
import { selectPlaylistTitle } from 'm3u-state';
import { Channel } from 'shared-interfaces';
import { ChannelListContainerComponent } from 'components';

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
    readonly activeView = input<string>('all');

    private readonly store = inject(Store);
    private readonly translate = inject(TranslateService);

    readonly playlistTitle = this.store.selectSignal(selectPlaylistTitle);

    readonly subtitle = computed(() => {
        const count = this.channels()?.length ?? 0;
        return `${count} ${this.translate.instant('HOME.PLAYLISTS.CHANNELS')}`;
    });
}
