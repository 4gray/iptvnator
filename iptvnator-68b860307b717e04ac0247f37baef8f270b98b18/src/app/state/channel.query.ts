import { Injectable } from '@angular/core';
import { QueryEntity } from '@datorama/akita';
import { ChannelStore, ChannelState } from './channel.store';

@Injectable({ providedIn: 'root' })
export class ChannelQuery extends QueryEntity<ChannelState> {
    constructor(protected store: ChannelStore) {
        super(store);
    }
}
