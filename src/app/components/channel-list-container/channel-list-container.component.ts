import { Component, Input, Output, EventEmitter } from '@angular/core';

@Component({
    selector: 'app-channel-list-container',
    templateUrl: './channel-list-container.component.html',
    styleUrls: ['./channel-list-container.component.css'],
})
export class ChannelListContainerComponent {
    /**
     * Channels array
     */
    @Input() channelList;

    /**
     * Emits on channel change
     */
    @Output() changeChannel: EventEmitter<{
        url: string;
        title: string;
    }> = new EventEmitter();
}
