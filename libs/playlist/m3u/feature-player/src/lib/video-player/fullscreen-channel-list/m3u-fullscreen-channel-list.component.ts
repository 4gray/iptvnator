import {
    ChangeDetectionStrategy,
    Component,
    input,
    linkedSignal,
    output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import {
    Channel,
    PlaylistRecentlyViewedItem,
} from '@iptvnator/shared/interfaces';
import { ChannelListContainerComponent } from '@iptvnator/ui/components';

export type M3uFullscreenChannelView =
    'all' | 'groups' | 'favorites' | 'recent';

export interface M3uFullscreenChannelViewOption {
    readonly id: M3uFullscreenChannelView;
    readonly labelKey: string;
    readonly icon: string;
}

export const M3U_FULLSCREEN_CHANNEL_VIEWS: readonly M3uFullscreenChannelViewOption[] =
    [
        { id: 'all', labelKey: 'CHANNELS.ALL_CHANNELS', icon: 'list' },
        { id: 'groups', labelKey: 'CHANNELS.GROUPS', icon: 'folder' },
        { id: 'favorites', labelKey: 'CHANNELS.FAVORITES', icon: 'star' },
        { id: 'recent', labelKey: 'PORTALS.SIDEBAR.RECENT', icon: 'history' },
    ];

export function toM3uFullscreenChannelView(
    view: string | null | undefined
): M3uFullscreenChannelView {
    return view === 'groups' || view === 'favorites' || view === 'recent'
        ? view
        : 'all';
}

/**
 * Body of the fullscreen channel panel for M3U playlists: a view switcher
 * (all / groups / favorites / recent) over the same channel list container
 * the sidebar renders. The view is local state on purpose — the sidebar's
 * tabs are routes, and switching a tab while fullscreen must not navigate
 * the page underneath the player.
 */
@Component({
    selector: 'app-m3u-fullscreen-channel-list',
    templateUrl: './m3u-fullscreen-channel-list.component.html',
    styleUrl: './m3u-fullscreen-channel-list.component.scss',
    imports: [ChannelListContainerComponent, MatIconModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class M3uFullscreenChannelListComponent {
    readonly channels = input<Channel[]>([]);
    readonly channelsLoading = input(false);
    /** The page's routed view; the panel opens on it and switches locally. */
    readonly initialView = input<string>('all');
    readonly recentItems = input<PlaylistRecentlyViewedItem[]>([]);
    readonly searchTerm = input('');
    readonly closeRequested = output<void>();

    readonly views = M3U_FULLSCREEN_CHANNEL_VIEWS;
    readonly view = linkedSignal<M3uFullscreenChannelView>(() =>
        toM3uFullscreenChannelView(this.initialView())
    );

    selectView(view: M3uFullscreenChannelView): void {
        this.view.set(view);
    }
}
