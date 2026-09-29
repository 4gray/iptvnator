import { createPlaylistObject } from '@iptvnator/shared/m3u-utils';
import { parse } from 'iptv-playlist-parser';
import { resolve } from 'node:path';

import type { CharsetBenchmarkVariant } from './charset-parse-benchmark-report';
import { SYNTHETIC_TITLE_VOCABULARY } from './synthetic-charset';
import { createSyntheticM3uFixture, SYNTHETIC_M3U_SEED } from './synthetic-m3u';
import { createSyntheticXmltvFixture } from './synthetic-xmltv';

export const ENTRY_COUNT = 50_000;
/**
 * The EPG worker writes 64 KiB decoded chunks. The benchmark writes slices of
 * one decoded string instead, so every slice keeps the input's one-byte or
 * two-byte representation (decoding each chunk separately would make the
 * BOM control one-byte after its first chunk) and no character is split.
 */
const XMLTV_CHUNK_CHARS = 64 * 1024;
const REPLACEMENT_CHARACTER = '\ufffd';
const UTF8_BYTE_ORDER_MARK = Buffer.from([0xef, 0xbb, 0xbf]);

type Variant = CharsetBenchmarkVariant;

interface ParsedProgramme {
    readonly title: readonly { readonly value: string }[];
}

interface StreamingEpgParserModule {
    StreamingEpgParser: new (
        onChannels: (channels: unknown[]) => void,
        onPrograms: (programs: ParsedProgramme[]) => void,
        onProgress: (channels: number, programs: number) => void,
        channelBatchSize?: number,
        programBatchSize?: number
    ) => { write(chunk: string): void; finish(): { totalPrograms: number } };
}

export interface Workload {
    readonly name: string;
    /** Prepares untimed input, then returns the timed operation. */
    prepare(variant: Variant): () => void;
    input(variant: Variant): string;
    /** Untimed check that the parser saw the fixture's exact titles. */
    verify(variant: Variant): void;
}

export async function createWorkloads(): Promise<Workload[]> {
    const epgModule = (await import(
        resolve(
            __dirname,
            '../../../electron-backend/src/app/workers/epg-streaming-parser.ts'
        )
    )) as StreamingEpgParserModule;
    const m3uBuffers = buffersPerVariant((charset) =>
        createSyntheticM3uFixture(ENTRY_COUNT, { charset })
    );
    const xmltvBuffers = buffersPerVariant((charset) =>
        createSyntheticXmltvFixture(ENTRY_COUNT, { charset })
    );
    const m3uInput = (variant: Variant) =>
        requireBuffer(m3uBuffers, variant).toString('utf8');
    const xmltvInput = (variant: Variant) =>
        requireBuffer(xmltvBuffers, variant).toString('utf8');

    const verifyM3u = (variant: Variant) => {
        const titles = titlesFor(variant);
        const [first] = parse(m3uInput(variant)).items;
        expectEqual(
            first?.name,
            `${titles.channel} ${SYNTHETIC_M3U_SEED}-000001`
        );
        expectEqual(first?.group.title, `${titles.group} 001`);
    };
    const parseXmltv = (
        variant: Variant,
        onPrograms: (programs: ParsedProgramme[]) => void
    ) => {
        const chunks = sliceText(xmltvInput(variant), XMLTV_CHUNK_CHARS);
        return () => {
            const parser = new epgModule.StreamingEpgParser(
                () => undefined,
                onPrograms,
                () => undefined,
                100,
                1000
            );
            for (const chunk of chunks) {
                parser.write(chunk);
            }
            assertCount(parser.finish().totalPrograms);
        };
    };

    return [
        {
            // PARSE_M3U phase of the main-process import.
            name: 'm3u parse',
            input: m3uInput,
            verify: verifyM3u,
            prepare(variant) {
                const body = m3uInput(variant);
                return () => assertCount(parse(body).items.length);
            },
        },
        {
            // NORMALIZE phase of the main-process import.
            name: 'm3u normalize',
            input: m3uInput,
            verify: verifyM3u,
            prepare(variant) {
                const parsed = parse(m3uInput(variant));
                return () =>
                    assertCount(
                        createPlaylistObject('benchmark', parsed, 'x', 'URL')
                            .count
                    );
            },
        },
        {
            // EPG worker's saxes-based parser; UTF-8 decoding is excluded.
            name: 'xmltv stream parse',
            input: xmltvInput,
            verify(variant) {
                const titles: string[] = [];
                parseXmltv(variant, (programs) => {
                    for (const programme of programs) {
                        titles.push(programme.title[0]?.value ?? '');
                    }
                })();
                const programme = titlesFor(variant).programme;
                expectEqual(titles[0], `${programme} 000001-0001`);
                expectEqual(titles.at(-1), `${programme} 000500-0100`);
                if (
                    titles.some((title) =>
                        title.includes(REPLACEMENT_CHARACTER)
                    )
                ) {
                    throw new Error(`${variant} XMLTV titles contain U+FFFD`);
                }
            },
            prepare: (variant) => parseXmltv(variant, () => undefined),
        },
    ];
}

function titlesFor(variant: Variant) {
    return SYNTHETIC_TITLE_VOCABULARY[
        variant === 'cyrillic' ? 'cyrillic' : 'latin1'
    ];
}

function sliceText(text: string, size: number): string[] {
    const chunks: string[] = [];
    for (let offset = 0; offset < text.length; offset += size) {
        chunks.push(text.slice(offset, offset + size));
    }
    return chunks;
}

function expectEqual(actual: string | undefined, expected: string): void {
    if (actual !== expected) {
        throw new Error(`Expected "${expected}", parsed "${String(actual)}"`);
    }
}

function buffersPerVariant(
    create: (charset: 'latin1' | 'cyrillic') => { body: string }
): Map<Variant, Buffer> {
    const latin1 = Buffer.from(create('latin1').body, 'utf8');
    return new Map<Variant, Buffer>([
        ['latin1', latin1],
        ['latin1-bom', Buffer.concat([UTF8_BYTE_ORDER_MARK, latin1])],
        ['cyrillic', Buffer.from(create('cyrillic').body, 'utf8')],
    ]);
}

function requireBuffer(
    buffers: Map<Variant, Buffer>,
    variant: Variant
): Buffer {
    const buffer = buffers.get(variant);
    if (!buffer) {
        throw new Error(`No fixture for ${variant}`);
    }
    return buffer;
}

function assertCount(count: number): void {
    if (count !== ENTRY_COUNT) {
        throw new Error(`Expected ${ENTRY_COUNT} entries, parsed ${count}`);
    }
}
