import { Injectable } from '@angular/core';
import { ChannelStore } from './channel.store';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ChannelService {
    constructor(private channelStore: ChannelStore, private http: HttpClient) {}

    /* get() {
        return this.http
            .get('')
            .pipe(tap(entities => this.channelStore.set(entities)));
    } */
}
