import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import {
    Component,
    ElementRef,
    HostListener,
    Input,
    ViewChild,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import * as _ from 'lodash';
import { map, skipWhile } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import * as PlaylistActions from '../../../state/actions';
import {
    selectActivePlaylistId,
    selectFavorites,
} from '../../../state/selectors';
@Component({
    selector: 'app-channel-list-container',
    templateUrl: './channel-list-container.component.html',
    styleUrls: ['./channel-list-container.component.scss'],
})
export class ChannelListContainerComponent {
    /**
     * Channels array
     * Create local copy of the store for local manipulations without updates in the store
     */
    _channelList: Channel[];
    get channelList(): Channel[] {
        return this._channelList;
    }

    @Input('channelList')
    set channelList(value: Channel[]) {
        this._channelList = value;
        this.groupedChannels = _.groupBy(value, 'group.title');
    }

    /** Object with channels sorted by groups */
    groupedChannels!: { [key: string]: Channel[] };

    /** Selected channel */
    selected!: Channel;

    /** Search term for channel filter */
    searchTerm: any = {
        name: '',
    };

    /** Search field element */
    @ViewChild('search') searchElement: ElementRef;

    /** Register ctrl+f as keyboard hotkey to focus the search input field */
    @HostListener('document:keypress', ['$event'])
    handleKeyboardEvent(event: KeyboardEvent): void {
        if (event.key === 'f' && event.ctrlKey) {
            this.searchElement.nativeElement.focus();
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
    favorites$ = this.store
        .select(selectFavorites)
        .pipe(
            map((favoriteChannelIds) =>
                favoriteChannelIds.map((favoriteChannelId) =>
                    this.channelList.find(
                        (channel) => channel.id === favoriteChannelId
                    )
                )
            )
        );

    constructor(
        private readonly store: Store,
        private snackBar: MatSnackBar,
        private translateService: TranslateService
    ) {}

    /**
     * Sets clicked channel as selected and emits them to the parent component
     * @param channel selected channel
     */
    selectChannel(channel: Channel): void {
        this.selected = channel;
        this.store.dispatch(PlaylistActions.setActiveChannel({ channel }));
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
            null,
            { duration: 2000 }
        );
        this.store.dispatch(PlaylistActions.updateFavorites({ channel }));
    }

    /**
     * Required for change detection mechanism to nor re-init the whole component after changes
     * @param index index of the channel item
     * @param channel channel object
     */
    trackByFn(index: number, channel: Channel): string {
        return channel.id;
    }

    drop(event: CdkDragDrop<Channel[]>, favorites: Channel[]) {
        moveItemInArray(favorites, event.previousIndex, event.currentIndex);
        this.store.dispatch(
            PlaylistActions.setFavorites({
                channelIds: favorites.map((item) => item.id),
            })
        );
    }
}
