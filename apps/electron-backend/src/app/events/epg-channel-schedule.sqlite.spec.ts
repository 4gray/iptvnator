/**
 * The single-channel schedule against a real database with the production
 * schema: a long history must not fill the row cap and hide today.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as shared from '@iptvnator/shared/database';
import {
    CHANNEL_SCHEDULE_LIMIT,
    CHANNEL_SCHEDULE_PAST_SLOTS,
    EpgQueryService,
} from './epg-query.service';

const SOURCE_URL = 'https://guide.example.com/epg.xml';
const NOW_MS = Date.parse('2026-06-21T12:10:00.000Z');
const SLOT_MS = 30 * 60_000;
/** Slot 0 starts at 12:00 and airs at NOW_MS. */
const FIRST_SLOT_MS = Date.parse('2026-06-21T12:00:00.000Z');

describe('EpgQueryService single-channel schedule window', () => {
    const service = new EpgQueryService('[Test EPG]', () => NOW_MS);
    let dataDirectory: string;

    /** Slots relative to the airing one: -1 ended at 12:00, 0 airs now. */
    function seedSlots(
        channelId: string,
        from: number,
        to: number,
        slotMs = SLOT_MS
    ): void {
        const seed = new Database(shared.getDatabasePath());
        const insertChannel = seed.prepare(
            'INSERT INTO epg_channels (id, display_name, source_url) VALUES (?, ?, ?)'
        );
        const insertProgram = seed.prepare(
            'INSERT INTO epg_programs (channel_id, start, stop, title, source_url) VALUES (?, ?, ?, ?, ?)'
        );
        seed.transaction(() => {
            insertChannel.run(channelId, `Channel ${channelId}`, SOURCE_URL);
            for (let slot = from; slot <= to; slot++) {
                const start = FIRST_SLOT_MS + slot * slotMs;
                insertProgram.run(
                    channelId,
                    new Date(start).toISOString(),
                    new Date(start + slotMs).toISOString(),
                    `Slot ${slot}`,
                    SOURCE_URL
                );
            }
        })();
        seed.close();
    }

    const titles = async (channelId: string) =>
        (
            await service.getChannelPrograms(channelId, {
                sourceUrls: [SOURCE_URL, 'https://guide.example.com/other.xml'],
            })
        ).map(({ title }) => title);

    beforeAll(async () => {
        dataDirectory = mkdtempSync(join(tmpdir(), 'iptvnator-epg-window-'));
        process.env['IPTVNATOR_E2E_DATA_DIR'] = dataDirectory;
        await shared.initDatabase();
        // Two weeks of history at 30 minutes: 672 ended slots, then a day.
        seedSlots('long-history', -672, 47);
        seedSlots('long-future', -10, 1_000);
        seedSlots('weekly-archive', -350, 350);
        seedSlots('offset-window', -420, 420, 2 * 60_000);
        for (const boundary of ['start', 'stop']) {
            seedSlots(`malformed-${boundary}`, 0, 19);
            const malformed = new Database(shared.getDatabasePath());
            const insert = malformed.prepare(
                'INSERT INTO epg_programs (channel_id, start, stop, title, source_url) VALUES (?, ?, ?, ?, ?)'
            );
            malformed.transaction(() => {
                for (let i = 0; i < CHANNEL_SCHEDULE_LIMIT; i++) {
                    const unknown = String(209901010000 + i);
                    insert.run(
                        `malformed-${boundary}`,
                        boundary === 'start'
                            ? unknown
                            : new Date(
                                  FIRST_SLOT_MS - (i + 1) * SLOT_MS
                              ).toISOString(),
                        boundary === 'stop' ? unknown : '2099-01-01T22:00:00Z',
                        `Malformed ${i}`,
                        SOURCE_URL
                    );
                }
            })();
            malformed.close();
        }
        seedSlots('short', -3, 3);
        // Two sources carry the airing slot; one says it already ended.
        const seed = new Database(shared.getDatabasePath());
        seed.prepare(
            'INSERT INTO epg_programs (channel_id, start, stop, title, source_url) VALUES (?, ?, ?, ?, ?)'
        ).run(
            'short',
            new Date(FIRST_SLOT_MS).toISOString(),
            new Date(NOW_MS - 60_000).toISOString(),
            'Slot 0',
            'https://guide.example.com/other.xml'
        );
        seed.close();
        seedSlots('split-history', -600, 47);
        const split = new Database(shared.getDatabasePath());
        const insert = split.prepare(
            'INSERT INTO epg_programs (channel_id, start, stop, title, source_url) VALUES (?, ?, ?, ?, ?)'
        );
        // Several late-ending copies split the most recent slots across now.
        for (let slot = -12; slot < 0; slot++) {
            insert.run(
                'split-history',
                new Date(FIRST_SLOT_MS + slot * SLOT_MS).toISOString(),
                new Date(NOW_MS + 60_000).toISOString(),
                `Slot ${slot}`,
                'https://guide.example.com/other.xml'
            );
        }
        // An airing event starts before the most recent past slots.
        insert.run(
            'short',
            '2026-06-21T12:15:00+02:00',
            '2026-06-21T15:00:00+02:00',
            'Synthetic Live Event',
            SOURCE_URL
        );
        split.close();
    });

    afterAll(() => {
        shared.closeDatabase();
        delete process.env['IPTVNATOR_E2E_DATA_DIR'];
        rmSync(dataDirectory, { recursive: true, force: true });
    });

    it('keeps today when the history alone exceeds the cap', async () => {
        const result = await titles('long-history');

        expect(result).toHaveLength(CHANNEL_SCHEDULE_LIMIT);
        expect(result).toContain('Slot 0');
        expect(result.at(-1)).toBe('Slot 47');
        // The nearest past fills what the 48 upcoming slots leave.
        expect(result[0]).toBe(`Slot ${48 - CHANNEL_SCHEDULE_LIMIT}`);
    });

    it('keeps the past slots for catch-up when the future is long', async () => {
        const result = await titles('long-future');

        expect(result).toHaveLength(CHANNEL_SCHEDULE_LIMIT);
        expect(result.slice(0, 11)).toEqual(
            Array.from({ length: 11 }, (_, i) => `Slot ${i - 10}`)
        );
        expect(result.at(-1)).toBe(`Slot ${CHANNEL_SCHEDULE_LIMIT - 11}`);
        expect(CHANNEL_SCHEDULE_PAST_SLOTS).toBeGreaterThan(10);
    });

    it.each(['start', 'stop'])(
        'retains usable programmes when unsupported %s times would fill the cap',
        async (boundary) => {
            expect(await titles(`malformed-${boundary}`)).toEqual(
                Array.from({ length: 20 }, (_, i) => `Slot ${i}`)
            );
        }
    );

    it('keeps every advertised catch-up slot while still returning the airing programme', async () => {
        const programmes = await service.getChannelPrograms('weekly-archive', {
            sourceUrls: [SOURCE_URL],
            nowMs: FIRST_SLOT_MS,
            archiveDays: 7,
        });
        const result = programmes.map((programme) => programme.title);

        expect(result.slice(0, 337)).toEqual(
            Array.from({ length: 337 }, (_, i) => `Slot ${i - 336}`)
        );
        expect(result).toContain('Slot 1');
        expect(result).not.toContain('Slot -337');
    });

    it('keeps the currently airing short programme after a 12-hour display correction', async () => {
        const providerNow = NOW_MS - 12 * 60 * 60_000 + 60_000;
        const programmes = await service.getChannelPrograms('offset-window', {
            sourceUrls: [SOURCE_URL],
            nowMs: providerNow,
        });
        expect(programmes).toHaveLength(CHANNEL_SCHEDULE_LIMIT);
        expect(
            programmes.find(
                ({ start, stop }) =>
                    Date.parse(start) <= providerNow &&
                    providerNow < Date.parse(stop)
            )?.title
        ).toBe('Slot -355');
    });

    it('keeps the cap full when sources split a slot across now', async () => {
        const result = await titles('split-history');

        expect(result).toHaveLength(CHANNEL_SCHEDULE_LIMIT);
        expect(new Set(result).size).toBe(CHANNEL_SCHEDULE_LIMIT);
        expect(result[0]).toBe(`Slot ${48 - CHANNEL_SCHEDULE_LIMIT}`);
    });

    it('returns a short schedule whole and in order, a slot the sources split once', async () => {
        expect(await titles('short')).toEqual([
            'Synthetic Live Event',
            ...Array.from({ length: 7 }, (_, i) => `Slot ${i - 3}`),
        ]);
    });
});
