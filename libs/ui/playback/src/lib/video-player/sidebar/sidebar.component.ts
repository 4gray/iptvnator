import {
    Component,
    inject,
    input,
    output,
    ChangeDetectionStrategy,
} from '@angular/core';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import { Channel } from '@iptvnator/shared/interfaces';
import { ChannelListContainerComponent } from '@iptvnator/ui/components';

@Component({
    selector: 'app-sidebar',
    templateUrl: './sidebar.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [ChannelListContainerComponent],
})
export class SidebarComponent {
    readonly channels = input<Channel[]>([]);
    readonly channelsLoading = input(false);
    readonly activeView = input<string>('all');
    readonly sidebarWidth = input<number | null>(null);
    readonly sidebarWidthRequested = output<number>();
    readonly sidebarWidthRequestEnded = output<number>();
    readonly sidebarToggleRequested = output<void>();
    /** Groups view only: the group whose channels are currently listed. */
    readonly selectedGroupChange = output<string | null>();

    private readonly playlistContext = inject(PlaylistContextFacade);

    readonly activePlaylist = this.playlistContext.activePlaylist;

    onSidebarWidthRequested(width: number): void {
        this.sidebarWidthRequested.emit(width);
    }

    onSidebarWidthRequestEnded(width: number): void {
        this.sidebarWidthRequestEnded.emit(width);
    }
}
