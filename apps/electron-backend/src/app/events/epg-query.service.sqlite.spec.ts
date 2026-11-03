/**
 * Runs the EPG lookups for a playlist larger than SQLite's 32766
 * bound-variable limit against a real database with the production schema.
 * A single `IN (…)` list over every channel id fails there with "too many SQL
 * variables", which the mocked query specs cannot observe.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as shared from '@iptvnator/shared/database';
import { getEpgMappingsBatch } from '../database/operations/epg-mapping.operations';
import { EpgQueryService } from './epg-query.service';

const SOURCE_URL = 'https://guide.example.com/epg.xml';
const CHANNEL_COUNT = 40_000;
const MAPPED_CHANNELS = [0, 15_000, CHANNEL_COUNT - 1];

describe('EpgQueryService against a real SQLite database', () => {
    const service = new EpgQueryService('[Test EPG]');
    const nowMs = Date.parse('2026-06-21T12:00:00.000Z');
    let dataDirectory: string;
    let db: shared.DatabaseInstance;

    beforeAll(async () => {
        dataDirectory = mkdtempSync(join(tmpdir(), 'iptvnator-epg-query-'));
        process.env['IPTVNATOR_E2E_DATA_DIR'] = dataDirectory;
        db = await shared.initDatabase();

        const seed = new Database(shared.getDatabasePath());
        const insertChannel = seed.prepare(
            'INSERT INTO epg_channels (id, display_name, source_url) VALUES (?, ?, ?)'
        );
        const insertProgram = seed.prepare(
            'INSERT INTO epg_programs (channel_id, start, stop, title, source_url) VALUES (?, ?, ?, ?, ?)'
        );
        const insertMapping = seed.prepare(
            'INSERT INTO epg_channel_mappings (channel_key, epg_channel_id) VALUES (?, ?)'
        );
        seed.transaction(() => {
            for (let i = 0; i < CHANNEL_COUNT; i++) {
                insertChannel.run(
                    `guide.${i}`,
                    `Guide Channel ${i}`,
                    SOURCE_URL
                );
                insertProgram.run(
                    `guide.${i}`,
                    '2026-06-21T11:30:00.000Z',
                    '2026-06-21T12:30:00.000Z',
                    `Show ${i}`,
                    SOURCE_URL
                );
            }
            for (const i of MAPPED_CHANNELS) {
                insertMapping.run(`stream-${i}`, `guide.${i}`);
            }
        })();
        seed.close();
    });

    afterAll(() => {
        shared.closeDatabase();
        delete process.env['IPTVNATOR_E2E_DATA_DIR'];
        rmSync(dataDirectory, { recursive: true, force: true });
    });

    it('returns the current programme for every channel id', async () => {
        const ids = Array.from(
            { length: CHANNEL_COUNT },
            (_, i) => `guide.${i}`
        );

        const result = await service.getCurrentProgramsBatch(ids, {
            sourceUrls: [SOURCE_URL],
            nowMs,
        });

        expect(ids.filter((id) => result[id])).toHaveLength(CHANNEL_COUNT);
        expect(result[`guide.${CHANNEL_COUNT - 1}`]?.title).toBe(
            `Show ${CHANNEL_COUNT - 1}`
        );
    });

    it('resolves display-name keys to metadata and current programmes', async () => {
        const names = Array.from(
            { length: CHANNEL_COUNT },
            (_, i) => `guide channel ${i}`
        );

        const metadata = await service.getChannelMetadata(names, {
            sourceUrls: [SOURCE_URL],
        });
        const programs = await service.getCurrentProgramsBatch(names, {
            sourceUrls: [SOURCE_URL],
            nowMs,
        });

        expect(names.filter((name) => metadata[name])).toHaveLength(
            CHANNEL_COUNT
        );
        expect(metadata['guide channel 123']?.id).toBe('guide.123');
        expect(names.filter((name) => programs[name])).toHaveLength(
            CHANNEL_COUNT
        );
        expect(programs['guide channel 123']?.title).toBe('Show 123');
    }, 60_000);

    it('returns manual mappings from every chunk of a large key list', async () => {
        const keys = Array.from(
            { length: CHANNEL_COUNT },
            (_, i) => `stream-${i}`
        );

        const mappings = await getEpgMappingsBatch(db, keys);

        expect(mappings).toEqual(
            new Map(MAPPED_CHANNELS.map((i) => [`stream-${i}`, `guide.${i}`]))
        );
    });
});
