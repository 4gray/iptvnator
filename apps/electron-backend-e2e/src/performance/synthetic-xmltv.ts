import { createHash } from 'node:crypto';

import {
    resolveSyntheticCharset,
    type SyntheticCharset,
    SYNTHETIC_TITLE_VOCABULARY,
} from './synthetic-charset';
import { SYNTHETIC_M3U_SEED } from './synthetic-m3u';

export const SYNTHETIC_XMLTV_PROGRAMME_COUNT = 50_000;
export const SYNTHETIC_XMLTV_PROGRAMMES_PER_CHANNEL = 100;
export const SUPPORTED_SYNTHETIC_XMLTV_PROGRAMME_COUNTS = [
    10_000,
    SYNTHETIC_XMLTV_PROGRAMME_COUNT,
    100_000,
] as const;

/** 2026-01-01T00:00:00Z; every programme lasts 30 minutes. */
const SCHEDULE_START_EPOCH_MS = Date.UTC(2026, 0, 1);
const PROGRAMME_DURATION_MS = 30 * 60 * 1000;

export type SyntheticXmltvProgrammeCount =
    (typeof SUPPORTED_SYNTHETIC_XMLTV_PROGRAMME_COUNTS)[number];

export interface SyntheticXmltvFixture {
    readonly body: string;
    readonly bytes: number;
    readonly channelCount: number;
    readonly charset: SyntheticCharset;
    readonly programmeCount: SyntheticXmltvProgrammeCount;
    readonly sha256: string;
}

export interface SyntheticXmltvFixtureOptions {
    /** Script of channel display names and programme titles. */
    readonly charset?: SyntheticCharset;
}

/**
 * Deterministic XMLTV document: all `<channel>` entries first, then
 * `SYNTHETIC_XMLTV_PROGRAMMES_PER_CHANNEL` consecutive programmes per
 * channel. Descriptions, categories and attributes stay ASCII in every
 * charset so only the titles decide the string encoding.
 */
export function createSyntheticXmltvFixture(
    programmeCount: number = SYNTHETIC_XMLTV_PROGRAMME_COUNT,
    options: SyntheticXmltvFixtureOptions = {}
): SyntheticXmltvFixture {
    assertSupportedProgrammeCount(programmeCount);
    const charset = resolveSyntheticCharset(options.charset);
    const titles = SYNTHETIC_TITLE_VOCABULARY[charset];
    const channelCount =
        programmeCount / SYNTHETIC_XMLTV_PROGRAMMES_PER_CHANNEL;
    const lines: string[] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<tv generator-info-name="iptvnator-synthetic">',
    ];

    for (let offset = 0; offset < channelCount; offset += 1) {
        const channelId = syntheticChannelId(offset);
        lines.push(
            `  <channel id="${channelId}"><display-name lang="${titles.language}">${
                titles.channel
            } ${SYNTHETIC_M3U_SEED}-${stableNumber(offset + 1, 6)}</display-name></channel>`
        );
    }

    const slotTimestamps = Array.from(
        { length: SYNTHETIC_XMLTV_PROGRAMMES_PER_CHANNEL + 1 },
        (_, slot) =>
            xmltvTimestamp(
                SCHEDULE_START_EPOCH_MS + slot * PROGRAMME_DURATION_MS
            )
    );
    for (let offset = 0; offset < channelCount; offset += 1) {
        const channelId = syntheticChannelId(offset);
        const channelNumber = stableNumber(offset + 1, 6);
        for (
            let slot = 0;
            slot < SYNTHETIC_XMLTV_PROGRAMMES_PER_CHANNEL;
            slot += 1
        ) {
            lines.push(
                `  <programme start="${slotTimestamps[slot]}" stop="${
                    slotTimestamps[slot + 1]
                }" channel="${channelId}"><title lang="${titles.language}">${
                    titles.programme
                } ${channelNumber}-${stableNumber(
                    slot + 1,
                    4
                )}</title><desc lang="en">Synthetic description for slot ${
                    slot + 1
                }.</desc><category lang="en">Synthetic</category></programme>`
            );
        }
    }

    lines.push('</tv>');
    const body = `${lines.join('\n')}\n`;
    return Object.freeze({
        body,
        bytes: Buffer.byteLength(body, 'utf8'),
        channelCount,
        charset,
        programmeCount,
        sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    });
}

function syntheticChannelId(offset: number): string {
    return `synthetic.${stableNumber(offset + 1, 6)}`;
}

function stableNumber(value: number, width: number): string {
    return String(value).padStart(width, '0');
}

function xmltvTimestamp(epochMs: number): string {
    const iso = new Date(epochMs).toISOString();
    return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(
        11,
        13
    )}${iso.slice(14, 16)}${iso.slice(17, 19)} +0000`;
}

function assertSupportedProgrammeCount(
    programmeCount: number
): asserts programmeCount is SyntheticXmltvProgrammeCount {
    if (
        !SUPPORTED_SYNTHETIC_XMLTV_PROGRAMME_COUNTS.some(
            (supported) => supported === programmeCount
        )
    ) {
        throw new Error(
            `Unsupported synthetic XMLTV programme count: ${programmeCount}`
        );
    }
}
