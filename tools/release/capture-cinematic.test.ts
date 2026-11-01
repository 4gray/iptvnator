import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import {
    cinematicCacheRows,
    SYNTHETIC_METADATA_KEY,
} from './capture-cinematic-cache';
import { validCaptureMetadataSettings } from './capture-tmdb-check';
import { validateManifest } from './screenshot-guards.mjs';
import {
    cinematicLiveFrameViolations,
    type CinematicLiveFrameReport,
} from './capture-cinematic-live';

describe('cinematic capture isolation', () => {
    it('rejects real keys and unexpected enabled states in either capture mode', () => {
        for (const settings of [
            { enabled: true, apiKey: 'unapproved-key' },
            { enabled: false, apiKey: 'unapproved-key' },
            { enabled: true, apiKey: '' },
        ]) {
            assert.equal(validCaptureMetadataSettings(settings), false);
            assert.equal(validCaptureMetadataSettings(settings, true), false);
        }
        assert.equal(validCaptureMetadataSettings(null), true);
        assert.equal(validCaptureMetadataSettings(null, true), false);
        const synthetic = { enabled: true, apiKey: SYNTHETIC_METADATA_KEY };
        assert.equal(validCaptureMetadataSettings(synthetic), false);
        assert.equal(validCaptureMetadataSettings(synthetic, true), true);
    });

    it('seeds title resolution with and without year and season text without remote artwork', () => {
        const rows = cinematicCacheRows('tv', 72000, {
            info: {
                name: 'Synthetic Roof Crew',
                plot: 'A fictional crew repairs a relay.',
                genre: 'Drama, Mystery',
                rating: '8.5',
                releaseDate: '2025-09-01',
            },
            seasons: [
                {
                    season_number: 1,
                    overview: 'The first six shifts.',
                    air_date: '2025-09-01',
                },
            ],
            episodes: {
                '1': [
                    {
                        id: '82011',
                        episode_num: 1,
                        title: 'Synthetic Dawn Shift',
                        info: {
                            plot: 'A fictional relay begins transmitting.',
                            duration_secs: 2640,
                            releasedate: '2025-10-01',
                        },
                    },
                ],
            },
        });
        for (const key of [
            'id:72000|v2',
            'title:synthetic roof crew|year:|v5',
            'title:synthetic roof crew|year:2025|v5',
            'id:72000|season:1',
        ]) {
            assert.ok(
                rows.some(
                    (row) => row.lookupKey === key && row.tmdbId === 72000
                )
            );
        }
        assert.equal(
            rows.every((row) => row.language === 'en-US'),
            true
        );
        assert.doesNotMatch(
            JSON.stringify(rows),
            /https?:|image\.tmdb|youtube/
        );
        const season = JSON.parse(rows.at(-1)?.payload ?? '{}');
        assert.equal(season.episodes[0].name, 'Synthetic Dawn Shift');
        assert.equal(season.episodes[0].still_path, null);
    });

    it('marks the classification capability as cached for movies and series', () => {
        for (const mediaType of ['movie', 'tv'] as const) {
            const [row] = cinematicCacheRows(mediaType, 62000, {
                info: {
                    name: 'Synthetic Test Production',
                    plot: 'An original fictional synopsis.',
                    genre: 'Drama',
                    rating: 8,
                    releasedate: '2026-01-01',
                },
            });
            const payload = JSON.parse(row.payload ?? '{}');
            const classification =
                mediaType === 'movie' ? 'release_dates' : 'content_ratings';
            assert.deepEqual(payload[classification], { results: [] });
            assert.deepEqual(payload.recommendations, { results: [] });
        }
    });

    it('uses only known setup actions and both themes in the cinematic manifest', () => {
        const manifest = JSON.parse(
            readFileSync(
                'tools/release/screenshots.cinematic.manifest.json',
                'utf8'
            )
        );
        assert.deepEqual(validateManifest(manifest), []);
        assert.equal(manifest.shots.length, 4);
        assert.deepEqual(
            manifest.shots
                .filter((shot: { slug: string }) =>
                    shot.slug.startsWith('dashboard')
                )
                .map((shot: { slug: string }) => shot.slug),
            ['dashboard', 'dashboard-live-channels']
        );
    });
});

describe('cinematic live dashboard frame', () => {
    const frame = (): CinematicLiveFrameReport => ({
        continueBottom: 880,
        liveTop: 920,
        viewportHeight: 1100,
        cards: Array.from({ length: 5 }, (_, index) => ({
            name: `Synthetic Channel ${index + 1}`,
            programme: `Synthetic Programme ${index + 1}`,
            timeRange: '18:00 – 18:30',
            logoLoaded: true,
            progressReady: true,
            bottom: 1040,
        })),
    });

    it('accepts a second rail with different channels and fully loaded current EPG', () => {
        assert.deepEqual(cinematicLiveFrameViolations(frame()), []);
    });

    it('rejects missing logos, pending EPG and placeholder metadata', () => {
        for (const patch of [
            { logoLoaded: false },
            { progressReady: false },
            { programme: '' },
            { name: '' },
            { timeRange: '' },
        ]) {
            const report = frame();
            Object.assign(report.cards[0], patch);
            assert.ok(cinematicLiveFrameViolations(report).length > 0);
        }
    });

    it('rejects clipped cards, repeated channels or incorrect rail placement', () => {
        const clipped = frame();
        clipped.cards[0].bottom = 1120;
        assert.ok(cinematicLiveFrameViolations(clipped).length > 0);
        const repeated = frame();
        repeated.cards[1].name = repeated.cards[0].name;
        assert.ok(cinematicLiveFrameViolations(repeated).length > 0);
        const above = frame();
        above.liveTop = 700;
        assert.ok(cinematicLiveFrameViolations(above).length > 0);
        const sparse = frame();
        sparse.cards = sparse.cards.slice(0, 2);
        assert.ok(cinematicLiveFrameViolations(sparse).length > 0);
    });
});

describe('committed cinematic artwork', () => {
    const root = 'apps/xtream-mock-server/public/marketing';
    const manifest = JSON.parse(
        readFileSync(path.join(root, 'cinematic-artwork.json'), 'utf8')
    );

    it('keeps ten decodable original assets with their final prompts and reference continuity', async () => {
        assert.equal(manifest.generationMode, 'built-in image_gen');
        assert.equal(manifest.assets.length, 10);
        const seen = new Set();
        for (const asset of manifest.assets) {
            assert.match(
                asset.file,
                /^(poster|backdrop|episode)\/[a-z0-9-]+\.png$/
            );
            assert.ok(!seen.has(asset.file), 'duplicate artwork identity');
            seen.add(asset.file);
            const file = path.join(root, asset.file);
            const image = sharp(file);
            const metadata = await image.metadata();
            await image.raw().toBuffer();
            assert.equal(metadata.format, 'png');
            assert.equal(metadata.width, asset.width);
            assert.equal(metadata.height, asset.height);
            assert.equal(statSync(file).size, asset.bytes);
            assert.ok((metadata.width ?? 0) >= 1000);
            const ratio = (metadata.width ?? 0) / (metadata.height ?? 1);
            assert.ok(
                Math.abs(ratio - (asset.kind === 'poster' ? 2 / 3 : 16 / 9)) <
                    0.01
            );
            assert.ok(asset.prompt.length > 500);
            assert.equal(asset.status, 'generated-and-visually-reviewed');
            if (asset.reference)
                assert.ok(statSync(path.join(root, asset.reference)).size > 0);
        }
    });
});
