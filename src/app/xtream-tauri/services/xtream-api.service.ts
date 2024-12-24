import { Injectable, inject } from '@angular/core';
import { XtreamCodeActions } from '../../../../shared/xtream-code-actions';
import { DataService } from '../../services/data.service';

export interface XtreamCredentials {
    url: string;
    username: string;
    password: string;
}

@Injectable({
    providedIn: 'root',
})
export class XtreamApiService {
    private dataService = inject(DataService);

    private buildUrl(baseUrl: string): string {
        return `${baseUrl}/player_api.php`;
    }

    async getCategories(
        credentials: XtreamCredentials,
        type: 'live' | 'vod' | 'series'
    ) {
        const action = this.getCategoryAction(type);
        return await this.dataService.fetchData(
            this.buildUrl(credentials.url),
            {
                action,
                username: credentials.username,
                password: credentials.password,
            }
        );
    }

    async getStreams(
        credentials: XtreamCredentials,
        type: 'live' | 'vod' | 'series'
    ) {
        const action = this.getStreamAction(type);
        return await this.dataService.fetchData(
            this.buildUrl(credentials.url),
            {
                action,
                username: credentials.username,
                password: credentials.password,
            }
        );
    }

    async getVodDetails(credentials: XtreamCredentials, vodId: string) {
        return await this.dataService.fetchData(
            this.buildUrl(credentials.url),
            {
                action: XtreamCodeActions.GetVodInfo,
                username: credentials.username,
                password: credentials.password,
                vod_id: vodId,
            }
        );
    }

    async getSerialDetails(credentials: XtreamCredentials, serialId: string) {
        return await this.dataService.fetchData(
            this.buildUrl(credentials.url),
            {
                action: XtreamCodeActions.GetSeriesInfo,
                username: credentials.username,
                password: credentials.password,
                series_id: serialId,
            }
        );
    }

    async getEpgData(credentials: XtreamCredentials, streamId: number) {
        return await this.dataService.fetchData(
            this.buildUrl(credentials.url),
            {
                action: 'get_short_epg',
                username: credentials.username,
                password: credentials.password,
                stream_id: streamId,
            }
        );
    }

    private getCategoryAction(
        type: 'live' | 'vod' | 'series'
    ): XtreamCodeActions {
        switch (type) {
            case 'live':
                return XtreamCodeActions.GetLiveCategories;
            case 'vod':
                return XtreamCodeActions.GetVodCategories;
            case 'series':
                return XtreamCodeActions.GetSeriesCategories;
        }
    }

    private getStreamAction(
        type: 'live' | 'vod' | 'series'
    ): XtreamCodeActions {
        switch (type) {
            case 'live':
                return XtreamCodeActions.GetLiveStreams;
            case 'vod':
                return XtreamCodeActions.GetVodStreams;
            case 'series':
                return XtreamCodeActions.GetSeries;
        }
    }
}
