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
const EPG_SLOTS = 12;

export function generateLiveStreams(
    categories: RawCategory[],
    itemsPerCategory: number
): RawLiveStream[] {
    const streams: RawLiveStream[] = [];
    let num = 1;

    for (const cat of categories) {
        for (let i = 0; i < itemsPerCategory; i++) {
            const streamId = LIVE_STREAM_ID_BASE + streams.length;
            streams.push({
                num: num++,
                name: `${faker.company.name()} TV`,
                stream_type: 'live',
                stream_id: streamId,
                stream_icon: `https://picsum.photos/seed/live-${streamId}/100/100`,
                epg_channel_id: `channel-${streamId}.mock`,
                added: String(Math.floor(Date.now() / 1000 - Math.random() * 1e7)),
                category_id: cat.category_id,
                custom_sid: '',
                direct_source: '',
                tv_archive: 0,
                tv_archive_duration: 0,
                rating_imdb: (Math.random() * 3 + 6).toFixed(1),
            });
        }
    }
    return streams;
}

/** Generate EPG listings for a single stream_id. Returns base64-encoded title/description. */
export function generateEpgListings(streamId: number): RawEpgListing[] {
    const listings: RawEpgListing[] = [];
    const nowSec = Math.floor(Date.now() / 1000);
    const startOffset = -(EPG_SLOTS / 2) * EPG_SLOT_MINUTES * 60;

    for (let i = 0; i < EPG_SLOTS; i++) {
        const startTs = nowSec + startOffset + i * EPG_SLOT_MINUTES * 60;
        const stopTs = startTs + EPG_SLOT_MINUTES * 60;
        const title = faker.company.catchPhrase();
        const description = faker.lorem.sentence();

        listings.push({
            id: String(streamId * 100 + i),
            epg_id: `channel-${streamId}.mock`,
            title: Buffer.from(title).toString('base64'),
            lang: 'en',
            start: new Date(startTs * 1000).toISOString().replace('T', ' ').replace('.000Z', ''),
            end: new Date(stopTs * 1000).toISOString().replace('T', ' ').replace('.000Z', ''),
            description: Buffer.from(description).toString('base64'),
            channel_id: `channel-${streamId}`,
            start_timestamp: String(startTs),
            stop_timestamp: String(stopTs),
        });
    }
    return listings;
}
