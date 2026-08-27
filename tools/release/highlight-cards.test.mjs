import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import sharp from 'sharp';

import {
    buildFeatureCardSvg,
    buildHeroCardSvg,
    CARD_HEIGHT,
    CARD_WIDTH,
    escapeXml,
    planHighlightCards,
    SHOT_TOP,
    TEXT_BOTTOM,
    wrapText,
} from './highlight-cards.mjs';
import {
    parseCardArguments,
    renderCards,
} from './generate-highlight-cards.mjs';

const tempDirs = [];

function makeTempDir() {
    const directory = mkdtempSync(path.join(tmpdir(), 'highlight-cards-'));

    tempDirs.push(directory);

    return directory;
}

function note(overrides = {}) {
    return {
        type: 'feature',
        area: 'playback',
        issues: [],
        screenshot: null,
        highlight: null,
        unknownKeys: [],
        body: 'Series now show an Up Next rail beside the player.',
        sourcePath: '.changes/playback-up-next.md',
        ...overrides,
    };
}

const planOptions = {
    version: '0.24.0',
    releaseSlug: 'v0-24',
    screenshotsDir: '/blog/v0-24/screenshots',
    theme: 'dark',
};

after(() => {
    for (const directory of tempDirs) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('wrapText', () => {
    it('wraps on word boundaries within the budget', () => {
        assert.deepEqual(wrapText('one two three four', 9, 3), [
            'one two',
            'three',
            'four',
        ]);
    });

    it('gives an overlong single word its own line instead of cutting it', () => {
        assert.deepEqual(wrapText('supercalifragilistic ok', 10, 3), [
            'supercalifragilistic',
            'ok',
        ]);
    });

    it('ellipsizes the last kept line on overflow', () => {
        const lines = wrapText('aaa bbb ccc ddd eee', 3, 2);

        assert.equal(lines.length, 2);
        assert.match(lines[1], /…$/);
    });
});

describe('escapeXml', () => {
    it('escapes markup and quote characters', () => {
        assert.equal(
            escapeXml(`<a> & "b" 'c'`),
            '&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;'
        );
    });
});

describe('planHighlightCards', () => {
    it('plans one card per highlight in group order plus a hero', () => {
        const plan = planHighlightCards(
            [
                note({ type: 'fix', body: 'Not highlighted.' }),
                note({
                    highlight: 'Up Next rail',
                    screenshot: 'up-next-rail',
                }),
                note({
                    type: 'breaking',
                    highlight: 'New settings',
                    sourcePath: '.changes/settings-rework.md',
                }),
            ],
            planOptions
        );

        assert.deepEqual(
            plan.feature.map((job) => job.fileName),
            ['card-settings-rework.png', 'card-playback-up-next.png']
        );
        assert.equal(
            plan.feature[1].screenshotPath,
            path.join('/blog/v0-24/screenshots', 'up-next-rail-dark.png')
        );
        assert.equal(plan.feature[0].screenshotPath, null);
        assert.deepEqual(plan.hero.headlines, [
            'New settings',
            'Up Next rail',
        ]);
        assert.equal(plan.hero.counts, '1 breaking change · 1 feature · 1 fix');
    });

    it('keeps card filenames unique when two highlights share a screenshot', () => {
        const plan = planHighlightCards(
            [
                note({
                    highlight: 'Rail on wide windows',
                    screenshot: 'up-next-rail',
                    sourcePath: '.changes/playback-up-next.md',
                }),
                note({
                    highlight: 'Rail progress bars',
                    screenshot: 'up-next-rail',
                    sourcePath: '.changes/playback-rail-progress.md',
                }),
            ],
            planOptions
        );

        assert.deepEqual(
            plan.feature.map((job) => job.fileName),
            ['card-playback-up-next.png', 'card-playback-rail-progress.png']
        );
        // Both still read the same shared screenshot.
        assert.equal(
            plan.feature[0].screenshotPath,
            plan.feature[1].screenshotPath
        );
    });

    it('never plans a card for internal notes', () => {
        const plan = planHighlightCards(
            [note({ type: 'internal', highlight: 'Nope' })],
            planOptions
        );

        assert.deepEqual(plan.feature, []);
        assert.deepEqual(plan.hero.headlines, []);
    });

    it('respects the requested screenshot theme', () => {
        const plan = planHighlightCards(
            [note({ highlight: 'Up Next rail', screenshot: 'up-next-rail' })],
            { ...planOptions, theme: 'light' }
        );

        assert.match(plan.feature[0].screenshotPath, /-light\.png$/);
    });
});

describe('card SVGs', () => {
    it('escapes user text and carries the version chip', () => {
        const svg = buildFeatureCardSvg(
            {
                slug: 'x',
                fileName: 'card-x.png',
                headline: 'Support <live> & "vod"',
                body: "The app's import.",
                screenshotPath: null,
            },
            '0.24.0'
        );

        assert.match(svg, /Support &lt;live&gt; &amp; &quot;vod&quot;/);
        assert.match(svg, /v0\.24\.0/);
        assert.doesNotMatch(svg, /<live>/);
    });

    it('draws the screenshot frame only when a screenshot exists', () => {
        const withShot = buildFeatureCardSvg(
            {
                headline: 'H',
                body: 'B',
                screenshotPath: '/shots/x-dark.png',
            },
            '0.24.0'
        );
        const without = buildFeatureCardSvg(
            { headline: 'H', body: 'B', screenshotPath: null },
            '0.24.0'
        );

        // The frame rect is the only element using the surface frame color.
        assert.match(withShot, /fill="#2e2e28"/);
        assert.doesNotMatch(without, /fill="#2e2e28"/);
    });

    it('keeps every body line clear of the opaque screenshot frame', () => {
        // A two-line headline plus a long body used to push the last body
        // line under the frame, which is painted after the text.
        const svg = buildFeatureCardSvg(
            {
                headline: 'Advanced subtitles with external files and styling',
                body: 'External subtitle files load from disk, timing shifts in half-second steps, and you can set caption size and colour — the settings stick between episodes.',
                screenshotPath: '/shots/x-dark.png',
            },
            '0.24.0'
        );
        const baselines = [...svg.matchAll(/<text[^>]*\sy="(\d+)"/g)].map(
            (match) => Number(match[1])
        );

        assert.ok(baselines.length > 0);
        for (const baseline of baselines) {
            assert.ok(
                baseline <= TEXT_BOTTOM,
                `baseline ${baseline} overlaps the frame at ${SHOT_TOP - 2}`
            );
        }
    });

    it('survives a whitespace-only headline instead of dying half-written', () => {
        assert.doesNotThrow(() =>
            buildHeroCardSvg({
                fileName: 'hero.png',
                version: '0.24.0',
                releaseSlug: 'v0-24',
                headlines: ['   '],
                counts: '1 feature',
            })
        );
    });

    it('lists at most four highlights on the hero and counts the rest', () => {
        const svg = buildHeroCardSvg({
            fileName: 'hero.png',
            version: '0.24.0',
            releaseSlug: 'v0-24',
            headlines: ['One', 'Two', 'Three', 'Four', 'Five'],
            counts: '5 features',
        });

        assert.match(svg, />Four</);
        assert.doesNotMatch(svg, />Five</);
        assert.match(svg, /…and 1 more/);
        assert.match(svg, /5 features/);
    });
});

describe('parseCardArguments', () => {
    it('requires a mode and defaults the theme', () => {
        assert.equal(parseCardArguments([]), null);
        assert.deepEqual(parseCardArguments(['--dry-run']), {
            mode: 'dry-run',
            theme: 'dark',
            version: null,
            dir: '.changes',
            out: null,
        });
    });

    it('parses the full flag set', () => {
        assert.deepEqual(
            parseCardArguments([
                '--generate',
                '--theme',
                'light',
                '--version',
                '0.24.0',
                '--dir',
                'notes',
                '--out',
                'cards',
            ]),
            {
                mode: 'generate',
                theme: 'light',
                version: '0.24.0',
                dir: 'notes',
                out: 'cards',
            }
        );
    });

    it('rejects bad usage', () => {
        for (const args of [
            ['--dry-run', '--generate'],
            ['--generate', '--theme', 'sepia'],
            ['--generate', '--version', '0.24'],
            ['--generate', '--nope'],
            ['--generate', '--out'],
        ]) {
            assert.equal(parseCardArguments(args), null, args.join(' '));
        }
    });
});

describe('renderCards', () => {
    it('renders 1200×630 PNGs plus the hero pair from a real screenshot', async () => {
        const shotsDir = makeTempDir();
        const outputDir = path.join(makeTempDir(), 'cards');
        const screenshotPath = path.join(shotsDir, 'up-next-rail-dark.png');

        await sharp({
            create: {
                width: 1280,
                height: 720,
                channels: 3,
                background: { r: 20, g: 20, b: 24 },
            },
        })
            .png()
            .toFile(screenshotPath);

        const plan = planHighlightCards(
            [
                note({ highlight: 'Up Next rail', screenshot: 'up-next-rail' }),
                note({
                    type: 'perf',
                    highlight: 'Faster imports',
                    body: 'Playlists import faster.',
                    sourcePath: '.changes/m3u-faster-imports.md',
                }),
            ],
            { ...planOptions, screenshotsDir: shotsDir }
        );
        const written = await renderCards(plan, '0.24.0', outputDir);

        assert.deepEqual(
            written.map((file) => path.basename(file)),
            [
                'card-playback-up-next.png',
                'card-m3u-faster-imports.png',
                'hero.png',
                'hero.jpg',
            ]
        );

        for (const file of written) {
            assert.ok(existsSync(file), file);
            const metadata = await sharp(file).metadata();

            assert.equal(metadata.width, CARD_WIDTH, file);
            assert.equal(metadata.height, CARD_HEIGHT, file);
        }
    });
});
