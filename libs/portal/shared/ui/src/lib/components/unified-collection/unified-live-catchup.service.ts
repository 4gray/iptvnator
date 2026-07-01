import { inject, Injectable, signal } from '@angular/core';
import { EpgRuntimeBridgeService } from '@iptvnator/epg/data-access';
import { PlaylistsService } from '@iptvnator/services';
import { EpgItem, EpgProgram, Playlist } from '@iptvnator/shared/interfaces';
import {
    resolveM3uCatchupUrl,
} from '@iptvnator/shared/m3u-utils';
import { XtreamUrlService } from '@iptvnator/portal/xtream/data-access';
import {
    EpgProgramActivationEvent,
} from '@iptvnator/ui/epg';
import {
    ResolvedLiveCollectionDetail,
    StreamResolverService,
} from '@iptvnator/portal/shared/data-access';
import {
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UnifiedLiveCatchupService {
    private readonly streamResolver = inject(StreamResolverService);
    private readonly xtreamUrlService = inject(XtreamUrlService);
    private readonly playlistsService = inject(PlaylistsService);
    private readonly epgBridge = inject(EpgRuntimeBridgeService);

    readonly activeItem = signal<UnifiedCollectionItem | null>(null);

    /** Portal EPG items converted to EpgProgram for the interactive list component. */
    epgItemsToPrograms(items: EpgItem[]): EpgProgram[] {
        return items.map((item) => ({
            start: item.start,
            stop: item.stop ?? item.end,
            channel: item.channel_id ?? item.id,
            title: item.title,
            desc: item.description ?? null,
            category: null,
            startTimestamp: this.parseEpgTimestamp(item.start_timestamp),
            stopTimestamp: this.parseEpgTimestamp(item.stop_timestamp),
        }));
    }

    /** Archive window (days) for the selected portal stream, or 0 if unavailable. */
    portalArchiveDays(item: UnifiedCollectionItem | null): number {
        if (!item?.xtreamId) return 0;
        if (item.tvArchive === 0) return 0;
        if (item.tvArchiveDuration != null && item.tvArchiveDuration !== 0) {
            return Math.max(0, Number(item.tvArchiveDuration));
        }
        return 0;
    }

    async onProgramActivated(
        event: EpgProgramActivationEvent,
        detail: ResolvedLiveCollectionDetail | null,
        item: UnifiedCollectionItem | null
    ): Promise<ResolvedLiveCollectionDetail | null> {
        if (!detail) return null;

        if (event.type === 'live') {
            return item
                ? await this.streamResolver.resolveLiveDetail(item)
                : null;
        }

        // M3U catchup
        if (detail.epgMode === 'm3u' && detail.channel) {
            const catchupUrl = resolveM3uCatchupUrl(
                detail.channel,
                event.program
            );
            if (!catchupUrl) return null;
            return {
                ...detail,
                playback: { ...detail.playback, streamUrl: catchupUrl },
            };
        }

        // Xtream catchup
        if (!item?.xtreamId) return null;

        try {
            const credentials = await this.getXtreamCredentials(
                item.playlistId
            );
            if (!credentials) return null;

            const startTimestamp = this.parseEpochSeconds(
                event.program.startTimestamp,
                event.program.start
            );
            const stopTimestamp = this.parseEpochSeconds(
                event.program.stopTimestamp,
                event.program.stop
            );
            if (startTimestamp == null || stopTimestamp == null) return null;

            const catchupUrl = await this.xtreamUrlService.resolveCatchupUrl(
                item.playlistId,
                credentials,
                item.xtreamId,
                startTimestamp,
                stopTimestamp
            );
            if (!catchupUrl) return null;
            return {
                ...detail,
                playback: { ...detail.playback, streamUrl: catchupUrl },
            };
        } catch {
            return null;
        }
    }

    private parseEpgTimestamp(value: string | undefined): number | undefined {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    }

    private parseEpochSeconds(
        timestamp: number | string | null | undefined,
        fallbackIso: string
    ): number | null {
        const parsed = Number.parseInt(String(timestamp ?? ''), 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        const ms = Date.parse(fallbackIso);
        return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    }

    private async getXtreamCredentials(
        playlistId: string
    ): Promise<{
        serverUrl: string;
        username: string;
        password: string;
    } | null> {
        const electronPlaylist =
            typeof window !== 'undefined'
                ? await window.electron?.dbGetAppPlaylist?.(playlistId)
                : null;
        const playlist: Playlist | null =
            electronPlaylist ??
            (await firstValueFrom(
                this.playlistsService.getPlaylistById(playlistId)
            ));

        if (
            !playlist ||
            !playlist.serverUrl ||
            !playlist.username ||
            !playlist.password
        ) {
            return null;
        }

        return {
            serverUrl: playlist.serverUrl,
            username: playlist.username,
            password: playlist.password,
        };
    }
}
