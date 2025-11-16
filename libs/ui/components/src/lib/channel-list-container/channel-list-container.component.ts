import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { CommonModule, KeyValue, TitleCasePipe } from '@angular/common';
import {
    Component,
    ElementRef,
    HostListener,
    inject,
    Input,
    OnDestroy,
    viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { FilterPipe } from '@iptvnator/pipes';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import * as _ from 'lodash';
import * as PlaylistActions from 'm3u-state';
import {
    selectActive,
    selectActivePlaylistId,
    selectFavorites,
} from 'm3u-state';
import { map, skipWhile } from 'rxjs';
import { EpgService } from 'services';
import { Channel } from 'shared-interfaces';
import { ChannelListItemComponent } from './channel-list-item/channel-list-item.component';

@Component({
    selector: 'app-channel-list-container',
    templateUrl: './channel-list-container.component.html',
    styleUrls: ['./channel-list-container.component.scss'],
    imports: [
        ChannelListItemComponent,
        CommonModule,
        DragDropModule,
        FilterPipe,
        FormsModule,
        MatDividerModule,
        MatExpansionModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatListModule,
        MatTabsModule,
        ScrollingModule,
        TitleCasePipe,
        TranslatePipe,
    ],
})
export class ChannelListContainerComponent implements OnDestroy {
    private readonly epgService = inject(EpgService);
    private readonly snackBar = inject(MatSnackBar);
    private readonly store = inject(Store);
    private readonly translateService = inject(TranslateService);

    /**
     * Channels array
     * Create local copy of the store for local manipulations without updates in the store
     */
    _channelList: Channel[] = [];
    get channelList(): Channel[] {
        return this._channelList;
    }

    @Input()
    set channelList(value: Channel[]) {
        this._channelList = value;
        this.groupedChannels = _.default.groupBy(value, 'group.title');
    }

    /** Object with channels sorted by groups */
    groupedChannels!: { [key: string]: Channel[] };

    /** Selected channel */
    readonly activeChannel = this.store.selectSignal(selectActive);

    /** Search term for channel filter */
    searchTerm: { name: string } = {
        name: '',
    };

    /** Search field element */
    readonly searchElement = viewChild<ElementRef<HTMLInputElement>>('search');

    /** Register ctrl+f as keyboard hotkey to focus the search input field */
    @HostListener('document:keypress', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent): void {
        if (event.key === 'f' && event.ctrlKey) {
            this.searchElement()?.nativeElement.focus();
        }
    }

    /** ID of the current playlist */
    playlistId$ = this.store
        .select(selectActivePlaylistId)
        .pipe(
            skipWhile(
                (playlistId) => playlistId === '' || playlistId === undefined
            )
        );

    /** List with favorites */
    favorites$ = this.store.select(selectFavorites).pipe(
        map(
            (
                favoriteChannelIds // TODO: move to selector
            ) =>
                favoriteChannelIds.map((favoriteChannelId) =>
                    this.channelList.find(
                        (channel) => channel.url === favoriteChannelId
                    )
                )
        )
    );

    /**
     * Sets clicked channel as active and dispatches to store
     * @param channel selected channel
     */
    selectChannel(channel: Channel): void {
        this.store.dispatch(PlaylistActions.setActiveChannel({ channel }));

        // Use tvg-id for EPG matching, fallback to channel name if not available
        const epgChannelId = channel?.tvg?.id?.trim() || channel?.name.trim();

        if (epgChannelId) {
            this.epgService.getChannelPrograms(epgChannelId);
        }
    }

    /**
     * Toggles favorite flag for the given channel
     * @param channel channel to update
     * @param clickEvent mouse click event
     */
    toggleFavoriteChannel(channel: Channel, clickEvent: MouseEvent): void {
        clickEvent.stopPropagation();
        this.snackBar.open(
            this.translateService.instant('CHANNELS.FAVORITES_UPDATED'),
            undefined,
            { duration: 2000 }
        );
        this.store.dispatch(PlaylistActions.updateFavorites({ channel }));
    }

    trackByFn(_: number, channel: Channel): string {
        return channel?.id;
    }

    drop(event: CdkDragDrop<Channel[]>, favorites: Channel[]) {
        moveItemInArray(favorites, event.previousIndex, event.currentIndex);
        this.store.dispatch(
            PlaylistActions.setFavorites({
                channelIds: favorites.map((item) => item.url),
            })
        );
    }

    ngOnDestroy() {
        this.store.dispatch(PlaylistActions.setChannels({ channels: [] }));
    }

    groupsComparator = (
        a: KeyValue<string, any[]>,
        b: KeyValue<string, any[]>
    ): number => {
        const numA = parseInt(a.key.replace(/\D/g, ''));
        const numB = parseInt(b.key.replace(/\D/g, ''));

        if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
        }

        return a.key.localeCompare(b.key);
    };
}
