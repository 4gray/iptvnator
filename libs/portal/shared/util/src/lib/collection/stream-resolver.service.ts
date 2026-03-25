import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DataService, PlaylistsService } from 'services';
import {
    EpgItem,
    EpgProgram,
    Playlist,
    ResolvedPortalPlayback,
    STALKER_REQUEST,
    StalkerPortalActions,
} from 'shared-interfaces';
import {
    XtreamApiService,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { UnifiedCollectionItem } from './unified-collection-item.interface';

interface StalkerCreateLinkResponse {
    readonly js?: { readonly cmd?: string };
}

@Injectable({ providedIn: 'root' })
export class StreamResolverService {
    private readonly playlistsService = inject(PlaylistsService);
    private readonly xtreamApi = inject(XtreamApiService);
    private readonly xtreamUrl = inject(XtreamUrlService);
    private readonly dataService = inject(DataService);
    private readonly stalkerSession = inject(StalkerSessionService);

    async resolvePlayback(
        item: UnifiedCollectionItem
    ): Promise<ResolvedPortalPlayback> {
        switch (item.sourceType) {
            case 'm3u':
                return this.resolveM3u(item);
            case 'xtream':
                return this.resolveXtream(item);
            case 'stalker':
                return this.resolveStalker(item);
        }
    }

    async loadEpgItems(item: UnifiedCollectionItem): Promise<EpgItem[]> {
        try {
            if (item.sourceType === 'm3u' && item.tvgId && window.electron?.getChannelPrograms) {
                const programs: EpgProgram[] =
                    await window.electron.getChannelPrograms(item.tvgId);
                return programs.map((p, i) => ({
                    id: String(i),
                    epg_id: p.channel,
                    title: p.title,
                    lang: 'en',
                    start: p.start,
                    end: p.stop,
                    stop: p.stop,
                    description: p.desc ?? '',
                    channel_id: p.channel,
                    start_timestamp: String(Math.floor(new Date(p.start).getTime() / 1000)),
                    stop_timestamp: String(Math.floor(new Date(p.stop).getTime() / 1000)),
                }));
            }
            if (item.sourceType === 'xtream' && item.xtreamId) {
                const creds = await this.getXtreamCredentials(item.playlistId);
                if (!creds) return [];
                return await this.xtreamApi.getShortEpg(creds, item.xtreamId, 10);
            }
        } catch {
            // ignore
        }
        return [];
    }

    async loadEpgForItems(
        items: UnifiedCollectionItem[]
    ): Promise<Map<string, EpgProgram | null>> {
        const epgMap = new Map<string, EpgProgram | null>();
        const now = Date.now();

        const xtreamByPlaylist = new Map<string, UnifiedCollectionItem[]>();
        for (const ch of items) {
            if (ch.sourceType === 'xtream' && ch.contentType === 'live') {
                const list = xtreamByPlaylist.get(ch.playlistId) ?? [];
                list.push(ch);
                xtreamByPlaylist.set(ch.playlistId, list);
            }
        }

        const tasks: Promise<void>[] = [];
        for (const ch of items) {
            if (ch.sourceType === 'm3u' && ch.tvgId && ch.contentType === 'live') {
                tasks.push(this.loadM3uEpg(ch, epgMap, now));
            }
        }
        for (const [playlistId, chList] of xtreamByPlaylist.entries()) {
            tasks.push(this.loadXtreamEpgBatch(playlistId, chList, epgMap, now));
        }

        await Promise.all(tasks.map((t) => t.catch(() => null)));
        return epgMap;
    }

    // ─── Private ──────────────────────────────────────

    private resolveM3u(item: UnifiedCollectionItem): ResolvedPortalPlayback {
        return {
            streamUrl: item.streamUrl ?? '',
            title: item.name,
            thumbnail: item.logo ?? null,
        };
    }

    private async resolveXtream(
        item: UnifiedCollectionItem
    ): Promise<ResolvedPortalPlayback> {
        const creds = await this.getXtreamCredentials(item.playlistId);
        if (!creds || item.xtreamId == null) {
            throw new Error('Missing Xtream credentials');
        }
        const streamUrl = this.xtreamUrl.constructLiveUrl(creds, item.xtreamId);
        return {
            streamUrl,
            title: item.name,
            thumbnail: item.logo ?? null,
        };
    }

    private async resolveStalker(
        item: UnifiedCollectionItem
    ): Promise<ResolvedPortalPlayback> {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(item.playlistId)
        )) as Playlist | undefined;

        const portalUrl = item.stalkerPortalUrl ?? playlist?.portalUrl ?? playlist?.url ?? '';
        const macAddress = item.stalkerMacAddress ?? playlist?.macAddress ?? '';

        const params = {
            action: StalkerPortalActions.CreateLink,
            cmd: item.stalkerCmd ?? '',
            type: 'itv' as const,
            disable_ad: '0',
            download: '0',
            JsHttpRequest: '1-xml',
        };

        let response: StalkerCreateLinkResponse | undefined;
        if (playlist?.isFullStalkerPortal && playlist) {
            response = await this.stalkerSession.makeAuthenticatedRequest(playlist, params);
        } else {
            response = await this.dataService.sendIpcEvent(STALKER_REQUEST, {
                url: portalUrl,
                macAddress,
                params,
            });
        }

        const rawCmd = response?.js?.cmd ?? '';
        const streamUrl = this.normalizeStalkerCmd(rawCmd);
        return {
            streamUrl,
            title: item.name,
            thumbnail: item.logo ?? null,
        };
    }

    private async getXtreamCredentials(playlistId: string) {
        const playlist = (await firstValueFrom(
            this.playlistsService.getPlaylistById(playlistId)
        )) as Playlist | undefined;
        if (!playlist?.serverUrl || !playlist.username || !playlist.password) return null;
        return {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
        };
    }

    private async loadM3uEpg(
        ch: UnifiedCollectionItem,
        epgMap: Map<string, EpgProgram | null>,
        now: number
    ): Promise<void> {
        if (!window.electron?.getChannelPrograms || !ch.tvgId) return;
        try {
            const programs: EpgProgram[] =
                await window.electron.getChannelPrograms(ch.tvgId);
            const current =
                programs.find(
                    (p) =>
                        new Date(p.start).getTime() <= now &&
                        now < new Date(p.stop).getTime()
                ) ?? null;
            epgMap.set(ch.tvgId.trim(), current);
        } catch {
            epgMap.set(ch.tvgId!.trim(), null);
        }
    }

    private async loadXtreamEpgBatch(
        playlistId: string,
        channels: UnifiedCollectionItem[],
        epgMap: Map<string, EpgProgram | null>,
        now: number
    ): Promise<void> {
        const creds = await this.getXtreamCredentials(playlistId);
        if (!creds) return;

        await Promise.all(
            channels.map(async (ch) => {
                if (!ch.xtreamId) return;
                try {
                    const items = await this.xtreamApi.getShortEpg(creds, ch.xtreamId, 2);
                    const nowSec = Math.floor(now / 1000);
                    const current =
                        items.find(
                            (p) =>
                                Number(p.start_timestamp) <= nowSec &&
                                nowSec < Number(p.stop_timestamp)
                        ) ?? null;
                    const epgKey = ch.tvgId?.trim() || ch.name?.trim();
                    if (epgKey) {
                        epgMap.set(
                            epgKey,
                            current
                                ? {
                                      start: new Date(Number(current.start_timestamp) * 1000).toISOString(),
                                      stop: new Date(Number(current.stop_timestamp) * 1000).toISOString(),
                                      channel: String(ch.xtreamId),
                                      title: current.title,
                                      desc: current.description ?? null,
                                      category: null,
                                  }
                                : null
                        );
                    }
                } catch {
                    // skip
                }
            })
        );
    }

    private normalizeStalkerCmd(value: string): string {
        const trimmed = String(value ?? '').trim();
        if (!trimmed) return '';
        const splitAt = trimmed.indexOf(' ');
        if (splitAt > 0) {
            const candidate = trimmed.slice(splitAt + 1).trim();
            if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
                return candidate;
            }
        }
        return trimmed;
    }
}
