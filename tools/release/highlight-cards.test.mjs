import assert from 'node:assert/strict';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import sharp from 'sharp';

import {
    buildFeatureCardSvg,
    buildHeroCardSvg,
    CARD_HEIGHT,
    CARD_WIDTH,
    escapeXml,
    estimateTextWidth,
    HERO_BULLET_MAX_WIDTH,
    isOwnedCardFile,
    planHighlightCards,
    SHOT_TOP,
    TEXT_BOTTOM,
    TEXT_MAX_WIDTH,
    wrapText,
} from './highlight-cards.mjs';
import {
    parseCardArguments,
    removeStaleCards,
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
    const budget = (maxWidth, fontSize, maxLines) => ({
        maxWidth,
        fontSize,
        maxLines,
    });

    it('wraps on word boundaries within the width budget', () => {
        assert.deepEqual(wrapText('one two three four', budget(60, 10, 4)), [
            'one two',
            'three four',
        ]);
        // A tighter budget breaks earlier, still only between words.
        assert.deepEqual(wrapText('one two three four', budget(30, 10, 4)), [
            'one',
            'two',
            'three',
            'four',
        ]);
    });

    it('breaks a word wider than the budget instead of overflowing the card', () => {
        const lines = wrapText('supercalifragilistic ok', budget(60, 10, 4));

        assert.ok(lines.length > 1);
        assert.equal(lines.join('').replace(/ /g, ''), 'supercalifragilisticok');
    });

    it('keeps every line inside the budget, wide glyphs included', () => {
        // Counting characters is not a width budget: 34 `W` at font-size 52
        // measures ~1948px where only 1072px are available.
        for (const [text, maxWidth, fontSize, maxLines] of [
            ['W'.repeat(60), TEXT_MAX_WIDTH, 52, 2],
            ['W'.repeat(60), TEXT_MAX_WIDTH, 62, 2],
            ['W'.repeat(60), HERO_BULLET_MAX_WIDTH, 30, 1],
            ['M'.repeat(200), TEXT_MAX_WIDTH, 23, 3],
            ['ЖЮ'.repeat(40), TEXT_MAX_WIDTH, 52, 2],
            ['Advanced subtitles with external files', TEXT_MAX_WIDTH, 52, 2],
        ]) {
            for (const line of wrapText(
                text,
                budget(maxWidth, fontSize, maxLines)
            )) {
                const width = estimateTextWidth(line, fontSize);

                assert.ok(
                    width <= maxWidth,
                    `"${line}" estimates ${Math.round(width)}px > ${maxWidth}px`
                );
            }
        }
    });

    it('treats uncalibrated scripts as full-width rather than narrow', () => {
        // CJK, kana, hangul and emoji are ~1 em; falling through to the
        // lowercase-Latin factor let a 60-glyph headline paint off-canvas.
        for (const glyph of ['界', 'ひ', '한', '🎉', 'Ω'.repeat(1)]) {
            const wide = estimateTextWidth(glyph.repeat(28), 52);

            assert.ok(
                wide > TEXT_MAX_WIDTH,
                `28 × "${glyph}" estimates only ${Math.round(wide)}px`
            );
        }
    });

    it('keeps a full-width headline inside the canvas', () => {
        for (const line of wrapText('界'.repeat(60), budget(TEXT_MAX_WIDTH, 52, 2))) {
            assert.ok(estimateTextWidth(line, 52) <= TEXT_MAX_WIDTH, line);
        }
    });

    it('estimates a wide glyph run near its measured rendered width', () => {
        // Calibration anchor: 34 `W` at font-size 52 renders ~1948px.
        const estimate = estimateTextWidth('W'.repeat(34), 52);

        assert.ok(estimate > 1800, `estimate ${estimate} is too low`);
    });

    it('ellipsizes the last kept line on overflow', () => {
        const lines = wrapText('aaa bbb ccc ddd eee', budget(30, 10, 2));

        assert.equal(lines.length, 2);
        assert.match(lines[1], /…$/);
        assert.ok(estimateTextWidth(lines[1], 10) <= 30);
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

    it('reports the public note count so an internal-only release is detectable', () => {
        assert.equal(
            planHighlightCards(
                [note({ type: 'internal', body: 'Churn.' })],
                planOptions
            ).publicNoteCount,
            0
        );
        assert.equal(
            planHighlightCards(
                [note(), note({ type: 'internal', body: 'Churn.' })],
                planOptions
            ).publicNoteCount,
            1
        );
    });

    it('emits only filenames the ownership predicate can reclaim', () => {
        // Nothing enforces the lowercase-slug filename convention, and a card
        // the cleanup pass cannot recognize is a card that lives forever.
        const plan = planHighlightCards(
            [
                note({
                    highlight: 'New UI',
                    sourcePath: '.changes/Player_New-UI.md',
                }),
                note({
                    highlight: 'Other',
                    sourcePath: '.changes/player.new.ui.md',
                }),
            ],
            planOptions
        );

        assert.deepEqual(
            plan.feature.map((job) => job.fileName),
            ['card-player-new-ui.png', 'card-player-new-ui-2.png']
        );
        for (const job of plan.feature) {
            assert.equal(isOwnedCardFile(job.fileName), true, job.fileName);
        }
    });

    it('claims only the files it writes', () => {
        for (const owned of ['card-playback-up-next.png', 'hero.png', 'hero.jpg']) {
            assert.equal(isOwnedCardFile(owned), true, owned);
        }

        for (const foreign of [
            'notes.txt',
            'card-Upper.png',
            'screenshot-dashboard-dark.png',
            'hero.webp',
        ]) {
            assert.equal(isOwnedCardFile(foreign), false, foreign);
        }
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

    it('removeStaleCards tolerates a missing directory and reports what it took', () => {
        const outputDir = path.join(makeTempDir(), 'never-created');

        assert.deepEqual(removeStaleCards(outputDir), []);

        mkdirSync(outputDir, { recursive: true });
        writeFileSync(path.join(outputDir, 'card-gone.png'), 'x');
        writeFileSync(path.join(outputDir, 'hero.jpg'), 'x');
        writeFileSync(path.join(outputDir, 'keep.txt'), 'x');

        assert.deepEqual(removeStaleCards(outputDir).sort(), [
            'card-gone.png',
            'hero.jpg',
        ]);
        assert.deepEqual(readdirSync(outputDir), ['keep.txt']);
    });

    it('removes its own stale cards but leaves other files alone', async () => {
        const outputDir = path.join(makeTempDir(), 'cards');

        mkdirSync(outputDir, { recursive: true });
        writeFileSync(path.join(outputDir, 'card-removed-feature.png'), 'old');
        writeFileSync(path.join(outputDir, 'notes.txt'), 'keep me');

        const plan = planHighlightCards(
            [note({ highlight: 'Faster imports' })],
            planOptions
        );

        await renderCards(plan, '0.24.0', outputDir);

        const remaining = readdirSync(outputDir).sort();

        assert.deepEqual(remaining, [
            'card-playback-up-next.png',
            'hero.jpg',
            'hero.png',
            'notes.txt',
        ]);
    });
});

describe('generate-highlight-cards CLI', () => {
    const CLI = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        'generate-highlight-cards.mjs'
    );

    function runCli(args) {
        const result = spawnSync(process.execPath, [CLI, ...args], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        return {
            status: result.status ?? 1,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
        };
    }

    it('fails on an empty notes directory instead of calling it internal-only', () => {
        // The realistic cause is running this step after `--consume`, which
        // deleted the notes; silently reporting "internal-only" would hide it.
        const emptyDir = makeTempDir();
        const result = runCli([
            '--generate',
            '--version',
            '0.24.0',
            '--dir',
            emptyDir,
            '--out',
            path.join(makeTempDir(), 'cards'),
        ]);

        assert.equal(result.status, 1);
        assert.match(result.stderr, /No notes found/);
        assert.match(result.stderr, /Render cards before consuming/);
        assert.doesNotMatch(result.stderr, /Internal-only/);
    });

    it('clears stale cards when a release becomes internal-only', () => {
        const notesDir = makeTempDir();
        const outputDir = path.join(makeTempDir(), 'cards');

        writeFileSync(
            path.join(notesDir, 'deps-bump.md'),
            '---\ntype: internal\narea: deps\n---\n\nBumped a parser.\n',
            'utf8'
        );
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(path.join(outputDir, 'card-old-feature.png'), 'stale');
        writeFileSync(path.join(outputDir, 'keep.txt'), 'mine');

        const result = runCli([
            '--generate',
            '--version',
            '0.24.0',
            '--dir',
            notesDir,
            '--out',
            outputDir,
        ]);

        assert.equal(result.status, 0);
        assert.match(result.stderr, /Internal-only release/);
        assert.deepEqual(readdirSync(outputDir), ['keep.txt']);
    });

    it('leaves stale cards untouched in dry-run mode', () => {
        const notesDir = makeTempDir();
        const outputDir = path.join(makeTempDir(), 'cards');

        writeFileSync(
            path.join(notesDir, 'deps-bump.md'),
            '---\ntype: internal\narea: deps\n---\n\nBumped a parser.\n',
            'utf8'
        );
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(path.join(outputDir, 'card-old-feature.png'), 'stale');

        const result = runCli([
            '--dry-run',
            '--version',
            '0.24.0',
            '--dir',
            notesDir,
            '--out',
            outputDir,
        ]);

        assert.equal(result.status, 0);
        assert.deepEqual(readdirSync(outputDir), ['card-old-feature.png']);
    });
});

describe('estimateTextWidth against real rendering', () => {
    /** Ink width of one rendered line, via sharp's trim. */
    async function measureRenderedWidth(text, fontSize) {
        const svg = [
            '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="240">',
            `<text x="0" y="150" font-family="DM Sans, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="800" fill="#fff">`,
            escapeXml(text),
            '</text></svg>',
        ].join('');
        const { info } = await sharp(Buffer.from(svg))
            .trim({ threshold: 1 })
            .toBuffer({ resolveWithObject: true });

        return info.width;
    }

    it('never under-estimates a rendered line', async () => {
        // The guard against the whole class of bug that produced this model:
        // an under-estimate skips both the wrap and the textLength clamp, and
        // the card is cropped with every unit test still passing.
        const samples = [
            ['Advanced subtitles with external files', 52],
            ['Live TV recordings in the download manager', 52],
            ['W'.repeat(34), 52],
            ['M'.repeat(34), 62],
            ['æ'.repeat(34), 52],
            ['œ'.repeat(30), 52],
            ['界'.repeat(28), 52],
            ['한'.repeat(28), 30],
            ['Дашборд с рекомендациями TMDB', 52],
            ['#@%&'.repeat(10), 52],
            ['Ünïcödé áccênts thrøughöut', 52],
        ];

        for (const [text, fontSize] of samples) {
            const measured = await measureRenderedWidth(text, fontSize);
            const estimate = estimateTextWidth(text, fontSize);

            assert.ok(
                estimate >= measured,
                `"${text.slice(0, 30)}" at ${fontSize}px: estimate ${Math.round(estimate)}px < measured ${measured}px`
            );
        }
    });
});
