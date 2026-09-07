import { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';

export function buildLiveItem(
    sourceType: 'm3u' | 'xtream' | 'stalker'
): UnifiedCollectionItem {
    if (sourceType === 'm3u') {
        return {
            uid: 'm3u::pl-1::m3u-channel',
            name: 'M3U Live',
            contentType: 'live',
            sourceType: 'm3u',
            playlistId: 'pl-1',
            playlistName: 'Playlist One',
            streamUrl: 'https://example.com/m3u.m3u8',
            channelId: 'm3u-channel',
            tvgId: 'm3u-channel',
            logo: 'm3u.png',
            radio: 'false',
        };
    }

    if (sourceType === 'xtream') {
        return {
            uid: 'xtream::pl-2::20',
            name: 'Xtream Live',
            contentType: 'live',
            sourceType: 'xtream',
            playlistId: 'pl-2',
            playlistName: 'Playlist Two',
            xtreamId: 20,
            tvgId: '20',
            logo: 'xtream.png',
        };
    }

    return {
        uid: 'stalker::pl-3::30',
        name: 'Stalker Live',
        contentType: 'live',
        sourceType: 'stalker',
        playlistId: 'pl-3',
        playlistName: 'Playlist Three',
        stalkerId: '30',
        stalkerCmd: 'ffmpeg http://stalker/30',
        tvgId: '30',
        logo: 'stalker.png',
    };
}

export function buildProgram(title: string): EpgProgram {
    return {
        start: '2026-03-26T11:00:00.000Z',
        stop: '2026-03-26T12:00:00.000Z',
        channel: 'test-channel',
        title,
        desc: `${title} description`,
        category: null,
    };
}

export function buildCurrentProgram(title: string): EpgProgram {
    const now = Date.now();
    return {
        start: new Date(now - 10 * 60 * 1000).toISOString(),
        stop: new Date(now + 10 * 60 * 1000).toISOString(),
        channel: 'test-channel',
        title,
        desc: `${title} description`,
        category: null,
    };
}

export function buildEpgItem(title: string): EpgItem {
    return {
        id: '1',
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: '2026-03-26T11:00:00.000Z',
        end: '2026-03-26T12:00:00.000Z',
        stop: '2026-03-26T12:00:00.000Z',
        channel_id: '1',
        start_timestamp: '1774522800',
        stop_timestamp: '1774526400',
    };
}

export function buildCurrentEpgItem(title: string): EpgItem {
    const now = Date.now();
    const start = now - 10 * 60 * 1000;
    const stop = now + 10 * 60 * 1000;

    return {
        id: '1',
        epg_id: '',
        title,
        description: `${title} description`,
        lang: '',
        start: new Date(start).toISOString(),
        end: new Date(stop).toISOString(),
        stop: new Date(stop).toISOString(),
        channel_id: '1',
        start_timestamp: String(Math.floor(start / 1000)),
        stop_timestamp: String(Math.floor(stop / 1000)),
    };
}

export function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}
