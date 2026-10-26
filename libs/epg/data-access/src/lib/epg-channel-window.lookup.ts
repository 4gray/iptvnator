import { EpgProgram, epgProviderClockMs } from '@iptvnator/shared/interfaces';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
import { normalizeEpgPrograms } from './epg-program-normalization.util';

/** Programme windows and coverage for one playlist channel key. */
export class EpgChannelWindowLookup {
    constructor(
        private readonly bridge: EpgRuntimeBridgeService,
        private readonly globalUrls: (excluding: string[]) => string[],
        private readonly offsetMinutes: () => number
    ) {}

    async programs(
        channelId: string,
        fromMs: number,
        toMs: number,
        playlistUrls: string[],
        providerClock = false
    ): Promise<EpgProgram[]> {
        const from = providerClock
            ? fromMs
            : epgProviderClockMs(fromMs, this.offsetMinutes());
        const to = providerClock
            ? toMs
            : epgProviderClockMs(toMs, this.offsetMinutes());
        for (const sourceUrls of this.scopes(playlistUrls)) {
            const result = await this.bridge.getProgramsForChannels({
                channelIds: [channelId],
                fromMs: from,
                toMs: to,
                ...(sourceUrls.length ? { sourceUrls } : {}),
            });
            const programs = normalizeEpgPrograms(result?.[channelId] ?? []);
            if (programs.length > 0) return programs;
        }
        return [];
    }

    /** Check for programmes on any practical guide date when this day is empty. */
    async hasAnyPrograms(
        channelId: string,
        playlistUrls: string[]
    ): Promise<boolean> {
        for (const sourceUrls of this.scopes(playlistUrls)) {
            const result = await this.bridge.getProgramCoverage({
                channelIds: [channelId],
                fromMs: Date.UTC(1900, 0, 1),
                toMs: Date.UTC(2100, 0, 1),
                ...(sourceUrls.length ? { sourceUrls } : {}),
            });
            if (result?.includes(channelId)) return true;
        }
        return false;
    }

    private scopes(playlistUrls: string[]): string[][] {
        const playlist = normalizeEpgUrls(playlistUrls);
        const global = this.globalUrls(playlist);
        return playlist.length
            ? [playlist, ...(global.length ? [global] : [])]
            : [global];
    }
}
