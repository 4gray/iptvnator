import { Component, Input, Output, EventEmitter } from '@angular/core';
import { Channel } from 'src/app/state';

@Component({
    selector: 'app-channel-list-container',
    templateUrl: './channel-list-container.component.html',
    styleUrls: ['./channel-list-container.component.css'],
})
export class ChannelListContainerComponent {
    /**
     * Channels array
     */
    @Input() channelList: Channel[];

    /** 
     * Selected channel 
     */
    selected: Channel;

    /**
     * Emits on channel change
     */
    @Output() changeChannel: EventEmitter<{
        url: string;
        title: string;
    }> = new EventEmitter();

    /**
     * Search term for channel filter
     */
    searchTerm: any = {
        inf: {
            title: '',
        },
    };

    /**
     * Sets clicked channel as selected and emits them to the parent component
     * @param channel selected channel
     */
    selectChannel(channel: Channel): void {
        this.selected = channel;
        this.changeChannel.emit({ url: channel.url, title: channel.inf.title});
    }
}
