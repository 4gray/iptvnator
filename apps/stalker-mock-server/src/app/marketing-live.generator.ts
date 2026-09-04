import {
    MARKETING_LIVE_CATEGORIES,
    MARKETING_LIVE_CHANNELS,
    MARKETING_LOGO_ASSET_PATH,
    MarketingLiveCategoryKey,
    marketingSlug,
} from '@iptvnator/shared/marketing-fixtures';
import type { RawCategory, RawChannel, RawEpgProgram } from './data-generator.js';

/**
 * ITV side of the `marketing-demo` scenario: the provider-neutral channel
 * list shared with the Xtream mock, logos served by this process from
 * `/assets/marketing/logo/<slug>.svg`, and a schedule built from the
 * channels' own fictional programme titles. Nothing here reaches a
 * third-party host, which is what lets the release screenshot guards accept
 * a Stalker live-TV frame.
 */

const STALKER_MARKETING_ITV_CATEGORY_IDS: Record<
    MarketingLiveCategoryKey,
    string
> = {
    newsroom: '1101',
    sports: '1102',
    family: '1103',
    culture: '1104',
};

const MARKETING_CHANNEL_ID_BASE = 11_000;
const SLOT_MINUTES = 60;
const TOTAL_DAYS = 7;

export function marketingLogoPath(name: string): string {
    return `${MARKETING_LOGO_ASSET_PATH}/${marketingSlug(name)}.svg?size=256x256`;
}

export function generateMarketingItvCategories(): RawCategory[] {
    return MARKETING_LIVE_CATEGORIES.map((category) => ({
        id: STALKER_MARKETING_ITV_CATEGORY_IDS[category.key],
        title: category.name,
        alias: marketingSlug(category.name).replace(/-/g, '_'),
    }));
}

export function generateMarketingChannels(): RawChannel[] {
    return MARKETING_LIVE_CHANNELS.map((channel, index) => {
        const id = String(MARKETING_CHANNEL_ID_BASE + index);

        return {
            id,
            name: channel.name,
            o_name: channel.name,
            cmd: `ffrt4://ch/live/${id}/index.m3u8`,
            logo: marketingLogoPath(channel.name),
            category_id: STALKER_MARKETING_ITV_CATEGORY_IDS[channel.categoryKey],
            tv_genre_id: STALKER_MARKETING_ITV_CATEGORY_IDS[channel.categoryKey],
            xmltv_id: `${marketingSlug(channel.name)}.fictional`,
            use_http_tmp_link: '1',
            use_load_balancing: '0',
        };
    });
}

/** Hourly slots for a week, cycling the channel's fixture titles. */
export function generateMarketingEpg(
    channelName: string,
    titles: readonly string[]
): RawEpgProgram[] {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const slotsPerDay = (24 * 60) / SLOT_MINUTES;

    return Array.from({ length: slotsPerDay * TOTAL_DAYS }, (_, index) => {
        const start = new Date(dayStart.getTime() + index * SLOT_MINUTES * 60_000);
        const stop = new Date(start.getTime() + SLOT_MINUTES * 60_000);
        const title = titles[index % titles.length] ?? channelName;

        return {
            id: String(index + 1),
            name: title,
            start: start.toISOString(),
            stop: stop.toISOString(),
            start_timestamp: Math.floor(start.getTime() / 1000),
            stop_timestamp: Math.floor(stop.getTime() / 1000),
            descr: `${title} on ${channelName}, part of the fictional IPTVnator demo schedule.`,
            category: 'Fictional',
        };
    });
}

export function marketingEpgTitlesFor(channelName: string): readonly string[] {
    return (
        MARKETING_LIVE_CHANNELS.find((channel) => channel.name === channelName)
            ?.epgTitles ?? [channelName]
    );
}
