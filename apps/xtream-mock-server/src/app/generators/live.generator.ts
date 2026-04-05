import { faker } from '@faker-js/faker';
import { RawCategory } from './categories.generator.js';

export interface RawLiveStream {
    num: number;
    name: string;
    stream_type: 'live';
    stream_id: number;
    stream_icon: string;
    epg_channel_id: string;
    added: string;
    category_id: string;
    custom_sid: string;
    direct_source: string;
    tv_archive: number;
    tv_archive_duration: number;
    rating_imdb: string;
}

export interface RawEpgListing {
    id: string;
    epg_id: string;
    title: string;       // base64-encoded
    lang: string;
    start: string;
    end: string;
    description: string; // base64-encoded
    channel_id: string;
    start_timestamp: string;
    stop_timestamp: string;
}

const LIVE_STREAM_ID_BASE = 10_000;
const EPG_SLOT_MINUTES = 30;
const EPG_PREVIOUS_DAYS = 2;
const EPG_NEXT_DAYS = 3;
const EPG_SLOTS =
    ((EPG_PREVIOUS_DAYS + EPG_NEXT_DAYS) * 24 * 60) / EPG_SLOT_MINUTES;

type BuildLiveStreamOptions = {
    num: number;
    name: string;
    streamId: number;
    categoryId: string;
    epgChannelId?: string;
    tvArchive?: number;
    tvArchiveDuration?: number;
};

type BuildEpgListingOptions = {
    id: string;
    epgId: string;
    title: string;
    description: string;
    startTimestamp: number;
    stopTimestamp: number;
    channelId: string;
    rawStringOffsetSeconds?: number;
    lang?: string;
};

export function generateLiveStreams(
    categories: RawCategory[],
    itemsPerCategory: number
): RawLiveStream[] {
    const streams: RawLiveStream[] = [];
    let num = 1;

    for (const cat of categories) {
        for (let i = 0; i < itemsPerCategory; i++) {
            const streamId = LIVE_STREAM_ID_BASE + streams.length;
            streams.push(
                buildLiveStream({
                    num: num++,
                    name: `${faker.company.name()} TV`,
                    streamId,
                    categoryId: cat.category_id,
                })
            );
        }
    }
    return streams;
}

/** Generate EPG listings for a single stream_id. Returns base64-encoded title/description. */
export function generateEpgListings(streamId: number): RawEpgListing[] {
    const listings: RawEpgListing[] = [];
    const nowSec = Math.floor(Date.now() / 1000);
    const startOffset = -EPG_PREVIOUS_DAYS * 24 * 60 * 60;

    for (let i = 0; i < EPG_SLOTS; i++) {
        const startTs = nowSec + startOffset + i * EPG_SLOT_MINUTES * 60;
        const stopTs = startTs + EPG_SLOT_MINUTES * 60;
        const title = faker.company.catchPhrase();
        const description = faker.lorem.sentence();

        listings.push(
            buildEpgListing({
                id: String(streamId * 100 + i),
                epgId: `channel-${streamId}.mock`,
                title,
                description,
                startTimestamp: startTs,
                stopTimestamp: stopTs,
                channelId: `channel-${streamId}.mock`,
            })
        );
    }
    return listings;
}

export function buildLiveStream(
    options: BuildLiveStreamOptions
): RawLiveStream {
    const {
        num,
        name,
        streamId,
        categoryId,
        epgChannelId = `channel-${streamId}.mock`,
        tvArchive = 1,
        tvArchiveDuration = 3,
    } = options;

    return {
        num,
        name,
        stream_type: 'live',
        stream_id: streamId,
        stream_icon: `https://picsum.photos/seed/live-${streamId}/100/100`,
        epg_channel_id: epgChannelId,
        added: String(Math.floor(Date.now() / 1000 - Math.random() * 1e7)),
        category_id: categoryId,
        custom_sid: '',
        direct_source: '',
        tv_archive: tvArchive,
        tv_archive_duration: tvArchiveDuration,
        rating_imdb: (Math.random() * 3 + 6).toFixed(1),
    };
}

export function buildEpgListing(
    options: BuildEpgListingOptions
): RawEpgListing {
    const {
        id,
        epgId,
        title,
        description,
        startTimestamp,
        stopTimestamp,
        channelId,
        rawStringOffsetSeconds = 0,
        lang = 'en',
    } = options;

    return {
        id,
        epg_id: epgId,
        title: Buffer.from(title).toString('base64'),
        lang,
        start: formatXtreamDateTime(
            startTimestamp + rawStringOffsetSeconds
        ),
        end: formatXtreamDateTime(stopTimestamp + rawStringOffsetSeconds),
        description: Buffer.from(description).toString('base64'),
        channel_id: channelId,
        start_timestamp: String(startTimestamp),
        stop_timestamp: String(stopTimestamp),
    };
}

function formatXtreamDateTime(timestampSeconds: number): string {
    return new Date(timestampSeconds * 1000)
        .toISOString()
        .replace('T', ' ')
        .replace('.000Z', '');
}
