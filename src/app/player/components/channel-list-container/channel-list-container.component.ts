import {
    Component,
    ElementRef,
    HostListener,
    Input,
    ViewChild,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import * as _ from 'lodash';
import { combineLatestWith, map, skipWhile } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import * as PlaylistActions from '../../../state/actions';
import {
    selectChannels,
    selectFavorites,
    selectPlaylistId,
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

    /** List with favorites */
    favorites$ = this.store.select(selectChannels).pipe(
        combineLatestWith(this.store.select(selectFavorites)),
        map(([channels, favorites]) =>
            channels.filter((channel) => favorites.includes(channel.id))
        )
    );

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
        .select(selectPlaylistId)
        .pipe(
            skipWhile(
                (playlistId) => playlistId === '' || playlistId === undefined
            )
        );

    /**
     * Creates an instance of ChannelListContainerComponent
     */
    constructor(private readonly store: Store, private snackBar: MatSnackBar) {}

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
        this.snackBar.open('Favorites were updated!', null, { duration: 2000 });
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
}
