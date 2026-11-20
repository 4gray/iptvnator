import { inject, Injectable } from '@angular/core';
import {
    normalizeXtreamServerUrl,
    type PlaylistMeta,
    type XtreamCategory,
    type XtreamContentType,
    XTREAM_REQUEST,
} from '@iptvnator/shared/interfaces';
import { DataService } from './data.service';

const actions = {
    live: ['get_live_categories', 'get_live_streams'],
    movie: ['get_vod_categories', 'get_vod_streams'],
    series: ['get_series_categories', 'get_series'],
} as const;

export interface FetchedXtreamCatalog {
    type: XtreamContentType;
    categories: XtreamCategory[];
    content: Record<string, unknown>[];
}

@Injectable({ providedIn: 'root' })
export class XtreamCatalogFetchService {
    private readonly data = inject(DataService);

    categories(playlist: PlaylistMeta, type: XtreamContentType) {
        return this.request<XtreamCategory>(playlist, actions[type][0]);
    }

    content(playlist: PlaylistMeta, type: XtreamContentType) {
        return this.request<Record<string, unknown>>(
            playlist,
            actions[type][1]
        );
    }

    private async request<T>(
        playlist: PlaylistMeta,
        action: string
    ): Promise<T[]> {
        const response = await this.data.sendIpcEvent<{
            type?: string;
            payload?: unknown;
        }>(XTREAM_REQUEST, {
            url: normalizeXtreamServerUrl(playlist.serverUrl ?? ''),
            ...(playlist.userAgent?.trim()
                ? { userAgent: playlist.userAgent.trim() }
                : {}),
            params: {
                username: playlist.username?.trim(),
                password: playlist.password?.trim(),
                action,
            },
        });
        if (response?.type === 'ERROR' || !Array.isArray(response?.payload)) {
            throw new Error('The source did not return a valid catalog.');
        }
        return response.payload as T[];
    }
}
