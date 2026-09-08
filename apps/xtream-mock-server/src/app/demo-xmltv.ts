import { MARKETING_LIVE_CHANNELS } from '@iptvnator/shared/marketing-fixtures';

/**
 * `/demo/guide.xml`: an XMLTV guide for the marketing live channels, so the
 * desktop app can import an EPG source that never leaves the machine. The
 * channel ids deliberately differ from any playlist's `tvg-id`, which is what
 * makes the manual "Map EPG channel" flow worth showing in guide screenshots.
 */
export function renderDemoXmltv(origin: string, now = new Date()): string {
    const slotMs = 30 * 60 * 1000;
    const roundedNow = now.getTime() - (now.getTime() % slotMs);
    const channels = MARKETING_LIVE_CHANNELS.map((channel) => ({
        id: `${slugify(channel.name)}.fictional`,
        name: channel.name,
        icon: `${origin}/assets/marketing/logo/${slugify(channel.name)}.svg?size=256x256`,
        titles: channel.epgTitles,
    }));
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
        '<tv generator-info-name="iptvnator-xtream-mock-server">',
    ];

    for (const channel of channels) {
        lines.push(
            `  <channel id="${escapeXml(channel.id)}">`,
            `    <display-name>${escapeXml(channel.name)}</display-name>`,
            `    <icon src="${escapeXml(channel.icon)}" />`,
            '  </channel>'
        );
    }

    for (const channel of channels) {
        for (let index = 0; index < 8; index += 1) {
            const title = channel.titles[index % channel.titles.length];
            const start = roundedNow + (index - 2) * slotMs;
            lines.push(
                `  <programme start="${formatXmltvDate(start)}" stop="${formatXmltvDate(start + slotMs)}" channel="${escapeXml(channel.id)}">`,
                `    <title>${escapeXml(title)}</title>`,
                `    <desc>${escapeXml(`${title} on ${channel.name}, part of the fictional IPTVnator demo schedule.`)}</desc>`,
                '  </programme>'
            );
        }
    }

    lines.push('</tv>', '');
    return lines.join('\n');
}

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function formatXmltvDate(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
        `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())} +0000`
    );
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
