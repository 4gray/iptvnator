import {
    Component,
    ElementRef,
    EventEmitter,
    HostListener,
    Input,
    Output,
    ViewChild,
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as _ from 'lodash';
import { Observable } from 'rxjs';
import { Channel } from '../../../../../shared/channel.interface';
import { Playlist } from '../../../../../shared/playlist.interface';
import { ChannelQuery, ChannelStore } from '../../../state';

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

    /** Meta information about current playlist */
    playlistMeta: Pick<Playlist, 'count' | 'filename'> = {
        count: this.channelQuery.getValue().playlistCount,
        filename: this.channelQuery.getValue().playlistFilename,
    };

    /** Toggles the sidebar view from channels to playlists */
    @Output() changeView = new EventEmitter<any>();

    /** Object with channels sorted by groups */
    groupedChannels: { [key: string]: Channel[] };

    /** Selected channel */
    selected: Channel;

    /** List with favorited channels */
    favorites$: Observable<Channel[]> = this.channelQuery.select((store) =>
        this.channelQuery
            .getAll()
            .filter((channel) => store.favorites.includes(channel.id))
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
    playlistId: string;

    /**
     * Creates an instance of ChannelListContainerComponent
     * @param channelQuery akita's channel query
     * @param channelStore akita's channel store
     * @param snackBar service to push snackbar notifications
     */
    constructor(
        private channelQuery: ChannelQuery,
        private channelStore: ChannelStore,
        private snackBar: MatSnackBar
    ) {
        this.playlistId = this.channelQuery.getValue().playlistId;
    }

    /**
     * Sets clicked channel as selected and emits them to the parent component
     * @param channel selected channel
     */
    selectChannel(channel: Channel): void {
        this.selected = channel;
        this.channelStore.setActiveChannel(channel);
    }

    /**
     * Toggles favorite flag for the given channel
     * @param channel channel to update
     * @param clickEvent mouse click event
     */
    toggleFavoriteChannel(channel: Channel, clickEvent: MouseEvent): void {
        clickEvent.stopPropagation();
        this.snackBar.open('Favorites were updated!', null, { duration: 2000 });
        this.channelStore.updateFavorite(channel);
    }

    /**
     * Required for change detection mechanism to nor re-init the whole component after changes
     * @param index index of the channel item
     * @param channel channel object
     */
    trackByFn(index: number, channel: Channel): string {
        return channel.id;
    }

    /**
     * Emits event to the parent to toggle to the playlists overview
     */
    showPlaylists() {
        this.changeView.emit('PLAYLISTS');
    }
}
