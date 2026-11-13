import {
    XtreamPlaylistData,
    XtreamUrlService,
} from '@iptvnator/portal/xtream/data-access';
import {
    EpgProgram,
    epgProviderClockMs,
    XTREAM_CLIENT_USER_AGENT,
} from '@iptvnator/shared/interfaces';
import {
    EpgArchiveCopyService,
    EpgArchiveDownloadService,
    EpgProgramActivationEvent,
    type EpgGuideCatchUp,
    type EpgGuideChannel,
    isWithinArchiveWindow,
} from '@iptvnator/ui/epg';
import { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

export function xtreamArchiveDays(item: XtreamLiveChannelItem | null): number {
    return Math.max(0, Number(item?.tv_archive_duration ?? 0) || 0);
}

export function supportsXtreamArchive(
    item: XtreamLiveChannelItem | null
): boolean {
    return Number(item?.tv_archive ?? 0) === 1 && xtreamArchiveDays(item) > 0;
}

export function createXtreamGuideCatchUp(
    offsetMinutes: () => number,
    resolve: (channel: EpgGuideChannel) => XtreamLiveChannelItem | undefined,
    play: (
        program: EpgProgram,
        item: XtreamLiveChannelItem,
        displayed: readonly EpgGuideChannel[]
    ) => void
): EpgGuideCatchUp {
    const available = (channel: EpgGuideChannel, program: EpgProgram) => {
        const item = resolve(channel);
        if (!item || !supportsXtreamArchive(item)) return undefined;
        const start = getProgramTimestampSeconds(
            program.start,
            program.startTimestamp
        );
        const stop = getProgramTimestampSeconds(
            program.stop,
            program.stopTimestamp
        );
        const now = epgProviderClockMs(Date.now(), offsetMinutes());
        return start &&
            stop &&
            stop > start &&
            stop * 1000 <= now &&
            isWithinArchiveWindow(start * 1000, xtreamArchiveDays(item), now)
            ? item
            : undefined;
    };
    return {
        canWatch: (channel, program) => !!available(channel, program),
        watch: (channel, program, displayed) => {
            const item = available(channel, program);
            if (item) play(program, item, displayed);
        },
    };
}

/** Archive actions capture their source without changing the playback session. */
export async function activateXtreamArchiveAction(
    event: EpgProgramActivationEvent,
    playlist: XtreamPlaylistData | null | undefined,
    item: XtreamLiveChannelItem,
    downloadsAvailable: boolean,
    services: {
        copy: EpgArchiveCopyService;
        downloads: EpgArchiveDownloadService;
        urls: XtreamUrlService;
    }
): Promise<void> {
    const start = getProgramTimestampSeconds(
        event.program.start,
        event.program.startTimestamp
    );
    const stop = getProgramTimestampSeconds(
        event.program.stop,
        event.program.stopTimestamp
    );
    const resolve = () =>
        playlist && start && stop && stop > start
            ? services.urls.resolveCatchupUrl(
                  playlist.id,
                  playlist,
                  item.xtream_id,
                  start,
                  stop,
                  playlist.serverTimezone
              )
            : null;
    if (event.type === 'copy-catchup-url') {
        await services.copy.copy(resolve);
        return;
    }
    if (
        event.type !== 'download-catchup' ||
        !downloadsAvailable ||
        !playlist ||
        !start ||
        !stop ||
        stop > Date.now() / 1000 ||
        stop <= start
    )
        return;
    const days = Number(item.tv_archive_duration ?? 0);
    await services.downloads.start(
        {
            playlistId: playlist.id,
            xtreamId: item.xtream_id,
            playlistType: 'xtream',
            serverUrl: playlist.serverUrl,
            title: event.program.title,
            posterUrl: item.poster_url ?? item.stream_icon ?? undefined,
            catchup: {
                channelName: item.title ?? item.name ?? '',
                startTimestamp: start,
                stopTimestamp: stop,
                ...(days > 0
                    ? { expiresAt: Math.floor(start + days * 86400) }
                    : {}),
            },
            headers: {
                userAgent:
                    playlist.userAgent?.trim() || XTREAM_CLIENT_USER_AGENT,
                referer: playlist.referrer,
                origin: playlist.origin,
            },
        },
        () =>
            services.urls.resolveCatchupUrl(
                playlist.id,
                playlist,
                item.xtream_id,
                start,
                stop,
                playlist.serverTimezone
            )
    );
}

export function getProgramTimestampSeconds(
    dateValue: string,
    unixTimestampValue?: number | string | null
): number | null {
    const unixTimestamp = Number.parseInt(String(unixTimestampValue ?? ''), 10);
    if (Number.isFinite(unixTimestamp) && unixTimestamp > 0) {
        return unixTimestamp;
    }

    const parsedDate = Date.parse(dateValue);
    return Number.isFinite(parsedDate) ? Math.floor(parsedDate / 1000) : null;
}
