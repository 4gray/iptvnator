import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Channel, ChannelStore, ChannelQuery } from '../state';

import * as _ from 'lodash';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@datorama/akita';

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
        // deep copy
        this._channelList = value; //JSON.parse(JSON.stringify(value));
        this.groupedChannels = _.groupBy(value, 'group.title');
    }

    /** Object with channels sorted by grouped */
    groupedChannels: { [key: string]: Channel[] };

    /** Selected channel */
    selected: Channel;

    /** Emits on channel change */
    @Output() changeChannel: EventEmitter<Channel> = new EventEmitter();

    /** List with favorited channels */
    favs: Channel[] = [];

    /** Search term for channel filter */
    searchTerm: any = {
        name: '',
    };

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
        this.channelQuery
            .selectAll({
                filterBy: (entity) => entity.fav === true,
            })
            .subscribe(
                (favs) => (this.favs = JSON.parse(JSON.stringify(favs)))
            );
    }

    /**
     * Sets clicked channel as selected and emits them to the parent component
     * @param channel selected channel
     */
    selectChannel(channel: Channel): void {
        this.selected = channel;
        this.changeChannel.emit(channel);
        this.channelStore.update((store) => ({
            ...store,
            active: channel,
        }));
    }

    /**
     * Toggles favorite flag for the given channel
     * @param channel channel to update
     * @param clickEvent mouse click event
     */
    favChannel(channel: Channel, clickEvent: MouseEvent): void {
        clickEvent.stopPropagation();
        channel.fav = !channel.fav;
        this.snackBar.open('Favorites were updated!', null, { duration: 2000 });

        this.channelStore.update(channel.id, { fav: channel.fav });
        // update channels fav flag in the database
        this.channelStore.update((store) => {
            const favorites = channel.fav
                ? [...store.favorites, channel.id]
                : [...store.favorites.filter((favId) => channel.id !== favId)];

            return {
                favorites,
            };
        });
    }
}
