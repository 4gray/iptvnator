import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
    groupNotes,
    loadNotes,
    parseNote,
    validateNote,
} from './release-notes.mjs';
import {
    BLOG_FALLBACK_THEME,
    groupNotesByTheme,
    renderBlogScaffold,
} from './release-notes-blog.mjs';
import {
    formatLongDate,
    releaseSlug,
    renderChangelogSection,
    renderGithubBody,
    upsertChangelogSection,
} from './release-notes-render.mjs';
import {
    extractPublicSection,
    extractSection,
    parseExtractArguments,
    runExtractorCli,
    runExtractorProcess,
} from './extract-changelog-section.mjs';

const tempDirs = [];

function makeNotesDir(files) {
    const directory = mkdtempSync(path.join(tmpdir(), 'release-notes-'));
    tempDirs.push(directory);

    for (const [name, content] of Object.entries(files)) {
        writeFileSync(path.join(directory, name), content, 'utf8');
    }

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

after(() => {
    for (const directory of tempDirs) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('parseNote', () => {
    it('parses frontmatter, issue list and body', () => {
        const parsed = parseNote(
            [
                '---',
                'type: feature',
                'area: playback',
                'issues: [1187, 1188]',
                'screenshot: up-next-rail',
                '---',
                '',
                'Series now show an Up Next rail.',
                '',
            ].join('\n'),
            '.changes/playback-up-next.md'
        );

        assert.equal(parsed.type, 'feature');
        assert.equal(parsed.area, 'playback');
        assert.deepEqual(parsed.issues, [1187, 1188]);
        assert.equal(parsed.screenshot, 'up-next-rail');
        assert.equal(parsed.body, 'Series now show an Up Next rail.');
        assert.deepEqual(parsed.unknownKeys, []);
    });

    it('strips trailing comments and quotes, and accepts a bare issue', () => {
        const parsed = parseNote(
            [
                '---',
                'type: fix # one of feature | fix | perf',
                "area: 'm3u'",
                'issues: 1204',
                '---',
                'Playlists with very long URLs parse again.',
            ].join('\n'),
            'x.md'
        );

        assert.equal(parsed.type, 'fix');
        assert.equal(parsed.area, 'm3u');
        assert.deepEqual(parsed.issues, [1204]);
    });

    it('parses an optional highlight headline', () => {
        const parsed = parseNote(
            [
                '---',
                'type: feature',
                'area: playback',
                'highlight: Up Next rail',
                '---',
                'Series now show an Up Next rail.',
            ].join('\n'),
            'x.md'
        );

        assert.equal(parsed.highlight, 'Up Next rail');
        assert.equal(note().highlight, null);
    });

    it('keeps `#` inside a highlight but still strips comments elsewhere', () => {
        const parsed = parseNote(
            [
                '---',
                'type: feature # one of feature | fix | perf',
                'area: portal',
                'highlight: Sources #N chip for alternative copies',
                '---',
                'Body.',
            ].join('\n'),
            'x.md'
        );

        assert.equal(parsed.type, 'feature');
        assert.equal(
            parsed.highlight,
            'Sources #N chip for alternative copies'
        );
    });

    it('skips whole-line comments', () => {
        const parsed = parseNote(
            ['---', '# a note to the author', 'type: fix', 'area: m3u', '---', 'B.'].join(
                '\n'
            ),
            'x.md'
        );

        assert.equal(parsed.type, 'fix');
        assert.deepEqual(parsed.unknownKeys, []);
    });

    it('only strips a balanced quote pair', () => {
        const parse = (value) =>
            parseNote(
                ['---', 'type: feature', 'area: p', `highlight: ${value}`, '---', 'B.'].join(
                    '\n'
                ),
                'x.md'
            ).highlight;

        assert.equal(parse('"Up Next" rail'), '"Up Next" rail');
        assert.equal(parse('"Up Next rail"'), 'Up Next rail');
        assert.equal(parse("'Up Next rail'"), 'Up Next rail');
        assert.equal(parse('"'), '"');
    });

    it('reduces a whitespace-only quoted value to empty', () => {
        const parsed = parseNote(
            ['---', 'type: feature', 'area: p', 'highlight: "  "', '---', 'B.'].join(
                '\n'
            ),
            'x.md'
        );

        assert.equal(parsed.highlight, '');
        assert.match(
            validateNote(parsed)[0],
            /`highlight` is present but empty/
        );
    });

    it('records unknown keys instead of dropping them silently', () => {
        const parsed = parseNote(
            ['---', 'type: fix', 'area: m3u', 'scope: m3u', '---', 'Body.'].join(
                '\n'
            ),
            'x.md'
        );

        assert.deepEqual(parsed.unknownKeys, ['scope']);
    });

    it('rejects a missing or unterminated frontmatter block', () => {
        assert.throws(
            () => parseNote('type: fix\nBody.', 'x.md'),
            /missing opening/
        );
        assert.throws(
            () => parseNote('---\ntype: fix\nBody.', 'x.md'),
            /missing closing/
        );
    });

    it('rejects duplicate keys', () => {
        assert.throws(
            () =>
                parseNote(
                    ['---', 'type: fix', 'type: feature', '---', 'Body.'].join(
                        '\n'
                    ),
                    'x.md'
                ),
            /duplicate frontmatter key/
        );
    });
});

describe('validateNote', () => {
    it('accepts a well-formed note', () => {
        assert.deepEqual(validateNote(note()), []);
    });

    it('rejects an unknown type', () => {
        const errors = validateNote(note({ type: 'chore' }));

        assert.equal(errors.length, 1);
        assert.match(errors[0], /unknown `type`: "chore"/);
    });

    it('rejects an unknown frontmatter key', () => {
        const errors = validateNote(note({ unknownKeys: ['scope'] }));

        assert.match(errors[0], /unknown frontmatter key: `scope`/);
    });

    it('rejects an empty body and an essay', () => {
        assert.match(validateNote(note({ body: '' }))[0], /body is empty/);
        assert.match(
            validateNote(note({ body: 'x'.repeat(401) }))[0],
            /max 400/
        );
    });

    it('rejects a non-slug area and screenshot', () => {
        assert.match(
            validateNote(note({ area: 'Playback Engine' }))[0],
            /`area` must be a lowercase slug/
        );
        assert.match(
            validateNote(note({ screenshot: 'Up Next' }))[0],
            /`screenshot` must be a lowercase slug/
        );
    });

    it('accepts a short highlight and rejects empty or oversized ones', () => {
        assert.deepEqual(
            validateNote(note({ highlight: 'Up Next rail' })),
            []
        );
        assert.match(
            validateNote(note({ highlight: '' }))[0],
            /`highlight` is present but empty/
        );
        // The cap is the hero card's single-line budget, so a valid highlight
        // always renders in full on every surface.
        assert.deepEqual(validateNote(note({ highlight: 'x'.repeat(60) })), []);
        assert.match(
            validateNote(note({ highlight: 'x'.repeat(61) }))[0],
            /max 60/
        );
    });

    it('rejects a highlight on an internal note', () => {
        const errors = validateNote(
            note({ type: 'internal', highlight: 'Invisible work' })
        );

        assert.match(errors[0], /`highlight` is not allowed on `type: internal`/);
    });

    it('rejects non-numeric issues', () => {
        assert.match(
            validateNote(note({ issues: [Number.NaN] }))[0],
            /`issues` must be positive integers/
        );
    });
});

describe('loadNotes', () => {
    it('returns an empty result for a missing directory', () => {
        const result = loadNotes(path.join(tmpdir(), 'definitely-not-here-9d3f'));

        assert.deepEqual(result, { notes: [], errors: [] });
    });

    it('skips README.md and reports per-file errors', () => {
        const directory = makeNotesDir({
            'README.md': '# How to write notes',
            'a-good.md': '---\ntype: fix\narea: m3u\n---\nParses again.',
            'b-bad.md': '---\ntype: chore\narea: m3u\n---\nNope.',
        });

        const { notes, errors } = loadNotes(directory);

        assert.equal(notes.length, 1);
        assert.equal(notes[0].area, 'm3u');
        assert.equal(errors.length, 1);
        assert.match(errors[0], /^b-bad\.md: unknown `type`/);
    });

    it('sorts notes by filename for stable output', () => {
        const directory = makeNotesDir({
            'z-last.md': '---\ntype: fix\narea: zzz\n---\nLast.',
            'a-first.md': '---\ntype: fix\narea: aaa\n---\nFirst.',
        });

        assert.deepEqual(
            loadNotes(directory).notes.map((entry) => entry.area),
            ['aaa', 'zzz']
        );
    });
});

describe('groupNotes', () => {
    it('orders groups by severity and drops empty ones', () => {
        const grouped = groupNotes([
            note({ type: 'fix' }),
            note({ type: 'breaking' }),
            note({ type: 'feature' }),
        ]);

        assert.deepEqual(
            grouped.map((group) => group.type),
            ['breaking', 'feature', 'fix']
        );
    });
});

describe('renderGithubBody', () => {
    it('groups entries, prefixes the area and links the PR', () => {
        const links = new Map([
            ['.changes/playback-up-next.md', { commit: 'abc1234', pr: 1231 }],
        ]);

        const body = renderGithubBody([note({ issues: [1187] })], { links });

        assert.match(body, /^## Features\n\n- \*\*playback\*\* — Series now/);
        assert.match(body, /\[#1231\]\(https:\/\/github\.com\/4gray\/iptvnator\/pull\/1231\)/);
        assert.match(body, /closes \[#1187\]/);
    });

    it('falls back to a commit link when the note carries no PR', () => {
        const links = new Map([
            ['.changes/playback-up-next.md', { commit: 'abcdef1234567' }],
        ]);

        assert.match(renderGithubBody([note()], { links }), /\[abcdef1\]\(.*\/commit\/abcdef1234567\)/);
    });

    it('omits internal notes from the user-facing body', () => {
        const body = renderGithubBody([
            note({ type: 'internal', body: 'Split the store feature.' }),
            note(),
        ]);

        assert.match(body, /## Features/);
        assert.doesNotMatch(body, /Internal|Split the store feature/);
    });
});

describe('renderChangelogSection', () => {
    it('links the compare range when a previous version is known', () => {
        const section = renderChangelogSection([note()], {
            version: '0.24.0',
            date: '2026-08-01',
            previousVersion: '0.23.0',
        });

        assert.match(
            section,
            /^# \[0\.24\.0\]\(https:\/\/github\.com\/4gray\/iptvnator\/compare\/v0\.23\.0\.\.\.v0\.24\.0\) \(2026-08-01\)/
        );
    });

    it('keeps internal notes but collapses them', () => {
        const section = renderChangelogSection(
            [note(), note({ type: 'internal', body: 'Split the store.' })],
            { version: '0.24.0', date: '2026-08-01' }
        );

        assert.match(section, /### Features/);
        assert.match(section, /<summary>Internal changes<\/summary>/);
        assert.match(section, /Split the store\./);
    });
});

describe('groupNotesByTheme', () => {
    it('folds areas into reader-facing themes in post order, unknown areas last', () => {
        const groups = groupNotesByTheme([
            note({ area: 'quantum', body: 'Odd.' }),
            note({ area: 'stalker', body: 'Stalker.' }),
            note({ area: 'xtream', body: 'Xtream.' }),
            note({ area: 'window-controls', body: 'Windows.' }),
        ]);

        assert.deepEqual(
            groups.map((group) => group.heading),
            [
                'Xtream',
                'Stalker portals',
                'Settings, import and the desktop app',
                BLOG_FALLBACK_THEME,
            ]
        );
        assert.equal(groups.at(-1).notes[0].body, 'Odd.');
    });
});

describe('renderBlogScaffold', () => {
    const options = { version: '0.24.0', date: '2026-08-01' };
    const spoilerOf = (content) => content.match(/<Spoiler[\s\S]*<\/Spoiler>/)?.[0] ?? '';

    it('emits a draft with TODO markers and a release meta block', () => {
        const content = renderBlogScaffold([note()], options);

        assert.match(content, /^---\ntitle: v0\.24 - Release Notes/);
        assert.match(content, /draft: true/);
        assert.match(content, /TODO/);
        assert.match(content, /releaseDate="August 1, 2026"/);
    });

    it('opens with a What changed table holding one row per highlight', () => {
        const content = renderBlogScaffold(
            [
                note({ highlight: 'Up Next rail' }),
                note({
                    area: 'stalker',
                    highlight: 'Portal login',
                    body: "Portals that ask for a login work; the app's do_auth step completes.",
                    sourcePath: '.changes/stalker-login.md',
                }),
                note({ type: 'fix', body: 'A plain fix.', sourcePath: '.changes/playback-fix.md' }),
            ],
            options
        );

        assert.match(content, /## What changed\n\n<ChangeTable\n {4}rows=\{\[/);
        assert.match(
            content,
            /area: 'Playback',\n\s+change: 'Series now show an Up Next rail beside the player\.',\n\s+impact: 'TODO/
        );
        // The theme is the default area label; apostrophes are JS-escaped.
        assert.match(
            content,
            /area: 'Stalker portals',\n\s+change: 'Portals that ask for a login work; the app\\'s do_auth step completes\.'/
        );
        assert.equal((content.match(/^\s+change: /gm) ?? []).length, 2);
        assert.match(content, /import ChangeTable from/);
    });

    it('omits the table and its import when nothing is highlighted', () => {
        const content = renderBlogScaffold([note()], options);

        assert.doesNotMatch(content, /## What changed/);
        assert.doesNotMatch(content, /import ChangeTable/);
    });

    it('puts highlight sections first, as h2 with a status pill, ahead of the themed sections', () => {
        const content = renderBlogScaffold(
            [
                note({ body: 'Plain feature.' }),
                note({ highlight: 'Up Next rail', sourcePath: '.changes/playback-rail.md' }),
            ],
            options
        );

        assert.match(
            content,
            /## Up Next rail\n\n<StatusPill type="new" \/>\n\nSeries now show an Up Next rail/
        );
        assert.ok(content.indexOf('## Up Next rail') < content.indexOf('## Playback'));
        assert.doesNotMatch(content, /^### /m);
    });

    it('gives screenshot notes their own section with a dark/light slider and the screenshot alert', () => {
        const content = renderBlogScaffold(
            [note({ screenshot: 'up-next-rail' })],
            options
        );

        assert.match(content, /## TODO headline \(playback\)/);
        assert.match(
            content,
            /\/iptvnator\/blog\/v0-24\/screenshots\/up-next-rail-dark\.png/
        );
        assert.match(
            content,
            /\/iptvnator\/blog\/v0-24\/screenshots\/up-next-rail-light\.png/
        );
        assert.match(content, /<Alert type="info" title="About the screenshots">/);
        assert.match(content, /import BlogImageSlider from/);
    });

    it('gives a highlight note without a screenshot its own section, no slider', () => {
        const content = renderBlogScaffold(
            [note({ highlight: 'Up Next rail' })],
            options
        );

        assert.match(content, /## Up Next rail/);
        assert.doesNotMatch(content, /<BlogImageSlider/);
        assert.doesNotMatch(content, /import BlogImageSlider/);
        assert.doesNotMatch(content, /About the screenshots/);
    });

    it('folds the remaining features into themed sections without the area prefix', () => {
        const content = renderBlogScaffold(
            [
                note({ area: 'stalker', body: 'Stalker thing.', sourcePath: '.changes/stalker-a.md' }),
                note({ area: 'xtream', body: 'Xtream thing.', sourcePath: '.changes/xtream-a.md' }),
                note({ area: 'quantum', body: 'Odd thing.', sourcePath: '.changes/quantum-a.md' }),
            ],
            options
        );

        assert.match(content, /## Xtream\n\n<StatusPill type="improved" \/>\n\n- Xtream thing\./);
        assert.match(content, /## Stalker portals\n\n<StatusPill type="improved" \/>\n\n- Stalker thing\./);
        assert.match(content, /## Other changes\n\n<StatusPill type="improved" \/>\n\n- Odd thing\./);
        assert.doesNotMatch(content, /\*\*stalker\*\* —/);
        assert.ok(content.indexOf('## Xtream') < content.indexOf('## Stalker portals'));
        assert.ok(content.indexOf('## Stalker portals') < content.indexOf('## Other changes'));
    });

    it('collapses fixes without a headline under a spoiler grouped by theme', () => {
        const content = renderBlogScaffold(
            [
                note({ type: 'fix', area: 'search', body: 'Search fix.', sourcePath: '.changes/search-a.md' }),
                note({ type: 'fix', area: 'stalker', body: 'Stalker fix.', sourcePath: '.changes/stalker-b.md' }),
                note({ type: 'fix', body: 'Player fix.', highlight: 'Big fix', sourcePath: '.changes/playback-b.md' }),
            ],
            options
        );
        const spoiler = spoilerOf(content);

        assert.match(content, /## Everything else\n\nThat is the part worth reading in one sitting\. The remaining 2 fixes are below/);
        assert.match(spoiler, /^<Spoiler title="Show the remaining fixes">\n\n\*\*Stalker portals\*\*\n\n- Stalker fix\./);
        assert.match(spoiler, /\*\*Search\*\*\n\n- Search fix\./);
        assert.match(spoiler, /\n\n<\/Spoiler>$/);
        assert.match(content, /import Spoiler from/);
        // A highlighted fix is a section of its own, never a spoiler line.
        assert.match(content, /## Big fix\n\n<StatusPill type="fixed" \/>\n\nPlayer fix\./);
        assert.doesNotMatch(spoiler, /Player fix/);
    });

    it('phrases a single remaining fix in the singular and skips the spoiler without fixes', () => {
        const single = renderBlogScaffold([note({ type: 'fix' })], options);
        const none = renderBlogScaffold([note()], options);

        assert.match(single, /The remaining 1 fix is below/);
        assert.doesNotMatch(none, /## Everything else/);
        assert.doesNotMatch(none, /import Spoiler/);
    });

    it('keeps breaking changes out of the spoiler and ahead of the themed sections', () => {
        const content = renderBlogScaffold(
            [
                note({ body: 'Feature.' }),
                note({ type: 'breaking', area: 'settings', body: 'Breaking.', sourcePath: '.changes/settings-b.md' }),
                note({ type: 'fix', area: 'settings', body: 'Fix.', sourcePath: '.changes/settings-f.md' }),
            ],
            options
        );

        assert.match(content, /## Breaking changes\n\n<StatusPill type="breaking" \/>\n\n- Breaking\./);
        assert.ok(content.indexOf('## Breaking changes') < content.indexOf('## Playback'));
        assert.doesNotMatch(spoilerOf(content), /Breaking\./);
    });

    it('renders performance notes in their own section after the themes', () => {
        const content = renderBlogScaffold(
            [note({ body: 'Feature.' }), note({ type: 'perf', body: 'Perf.', sourcePath: '.changes/playback-p.md' })],
            options
        );

        assert.match(content, /## Performance\n\n<StatusPill type="improved" \/>\n\n- Perf\./);
        assert.ok(content.indexOf('## Playback') < content.indexOf('## Performance'));
    });

    it('orders the post: table, highlights, breaking, themes, performance, spoiler, closing', () => {
        const content = renderBlogScaffold(
            [
                note({ highlight: 'Headline', sourcePath: '.changes/a.md' }),
                note({ type: 'breaking', body: 'Breaking.', sourcePath: '.changes/b.md' }),
                note({ body: 'Feature.', sourcePath: '.changes/c.md' }),
                note({ type: 'perf', body: 'Perf.', sourcePath: '.changes/d.md' }),
                note({ type: 'fix', body: 'Fix.', sourcePath: '.changes/e.md' }),
            ],
            options
        );
        const order = [
            '## What changed',
            '## Headline',
            '## Breaking changes',
            '## Playback',
            '## Performance',
            '## Everything else',
            'title="Before updating"',
            '## Thanks',
            '## Download',
        ].map((marker) => content.indexOf(marker));

        assert.ok(order.every((index) => index >= 0), `missing marker in ${order}`);
        assert.deepEqual(order, [...order].sort((a, b) => a - b));
    });

    it('closes with the before-updating alert, thanks and download cards', () => {
        const content = renderBlogScaffold([note()], options);

        assert.match(content, /<Alert type="warning" title="Before updating">\nPlease back up/);
        assert.match(content, /## Thanks\n\n\{\/\* TODO/);
        assert.match(content, /## Download\n\n<LinkCards/);
        assert.match(content, /label: 'Download v0\.24\.0',\n\s+href: 'https:\/\/github\.com\/4gray\/iptvnator\/releases\/tag\/v0\.24\.0'/);
        assert.match(content, /label: 'All Releases'/);
        assert.doesNotMatch(content, /Full Changelog/);
    });

    it('adds the compare card only when the previous version is known', () => {
        const content = renderBlogScaffold([note()], {
            ...options,
            previousVersion: '0.23.0',
        });

        assert.match(content, /label: 'Full Changelog'/);
        assert.match(content, /compare\/v0\.23\.0\.\.\.v0\.24\.0/);
        assert.match(content, /hint: 'Every commit between v0\.23\.0 and v0\.24\.0\.'/);
    });

    it('truncates a long body for image alt text without cutting mid-word', () => {
        const body = `${'Series show the rest of the season beside the player '.repeat(4)}now.`;
        const content = renderBlogScaffold(
            [note({ body, screenshot: 'up-next-rail' })],
            options
        );
        const alt = content.match(/alt: '([^']*)'/)[1];

        assert.ok(alt.length <= 121, `alt was ${alt.length} characters`);
        assert.match(alt, /…$/);
        assert.doesNotMatch(alt, /\s…$/);
    });

    it('escapes backslashes and apostrophes inside the alt string literal', () => {
        const content = renderBlogScaffold(
            [
                note({
                    body: "Windows paths like C:\\Users no longer break the app's import.",
                    screenshot: 'windows-import',
                }),
            ],
            options
        );
        const alt = content.match(/alt: '(.*)',/)[1];

        assert.match(alt, /C:\\\\Users/);
        assert.match(alt, /app\\'s/);
        // An odd number of trailing backslashes would escape the closing quote.
        assert.doesNotMatch(alt, /(^|[^\\])(\\\\)*\\$/);
    });

    it('escapes backslashes and apostrophes inside table cells', () => {
        const content = renderBlogScaffold(
            [
                note({
                    highlight: 'Windows import',
                    body: "Windows paths like C:\\Users no longer break the app's import.",
                }),
            ],
            options
        );

        assert.match(content, /change: 'Windows paths like C:\\\\Users no longer break the app\\'s import\.'/);
    });

    it('escapes characters MDX would parse as markup', () => {
        const content = renderBlogScaffold(
            [note({ body: 'Channels named <live> and {vod} now sort correctly.' })],
            options
        );

        assert.doesNotMatch(content, /<live>/);
        assert.doesNotMatch(content, /\{vod\}/);
        assert.match(content, /&lt;live&gt;/);
        assert.match(content, /&#123;vod&#125;/);
    });

    it('imports only the components it emits, alphabetically', () => {
        const content = renderBlogScaffold([note()], options);
        const imports = content.match(/^import \w+ from/gm);

        assert.deepEqual(imports, [
            'import Alert from',
            'import LinkCards from',
            'import ReleaseMeta from',
            'import StatusPill from',
        ]);
    });

    it('omits internal notes entirely', () => {
        const content = renderBlogScaffold(
            [note(), note({ type: 'internal', body: 'Internal plumbing.', sourcePath: '.changes/deps-x.md' })],
            options
        );

        assert.doesNotMatch(content, /Internal plumbing/);
    });
});

describe('upsertChangelogSection', () => {
    const marker = '<!-- next-release -->';
    const base = [
        '# Changelog',
        '',
        marker,
        '',
        '# [0.12.0](https://example.com) (2023-03-11)',
        '',
        '- old entry',
    ].join('\n');

    it('inserts a new section below the marker', () => {
        const { content, replaced } = upsertChangelogSection(
            base,
            '# [0.24.0](url) (2026-08-01)\n\n### Features\n\n- entry',
            '0.24.0',
            marker
        );

        assert.equal(replaced, false);
        assert.match(
            content,
            /<!-- next-release -->\n\n# \[0\.24\.0\]\(url\) \(2026-08-01\)/
        );
        assert.match(content, /- entry\n\n# \[0\.12\.0\]/);
    });

    it('replaces an existing section for the same version instead of duplicating', () => {
        const first = upsertChangelogSection(
            base,
            '# [0.24.0](url) (2026-08-01)\n\n- v1 entry',
            '0.24.0',
            marker
        ).content;
        const { content, replaced } = upsertChangelogSection(
            first,
            '# [0.24.0](url) (2026-08-02)\n\n- v2 entry',
            '0.24.0',
            marker
        );

        assert.equal(replaced, true);
        assert.equal(content.match(/^# \[0\.24\.0\]/gm).length, 1);
        assert.match(content, /v2 entry/);
        assert.doesNotMatch(content, /v1 entry/);
        assert.match(content, /- v2 entry\n\n# \[0\.12\.0\]/);
    });

    it('keeps other versions untouched when replacing', () => {
        const first = upsertChangelogSection(
            base,
            '# [0.24.0](url) (2026-08-01)\n\n- v1',
            '0.24.0',
            marker
        ).content;
        const { content } = upsertChangelogSection(
            first,
            '# [0.24.1](url) (2026-08-09)\n\n- patch',
            '0.24.1',
            marker
        );

        assert.match(content, /0\.24\.1.*\n\n- patch\n\n# \[0\.24\.0\]/);
        assert.match(content, /- v1\n\n# \[0\.12\.0\]/);
    });

    it('throws when the marker is missing', () => {
        assert.throws(
            () => upsertChangelogSection('# Changelog', '# s', '0.24.0', marker),
            /missing the/
        );
    });
});

const changelog = [
    '# Changelog',
    '',
    'Intro paragraph with a pointer.',
    '',
    '<!-- next-release -->',
    '',
    '# [0.24.0](https://github.com/4gray/iptvnator/compare/v0.23.0...v0.24.0) (2026-08-01)',
    '',
    '### Features',
    '',
    '- **playback** — Up Next rail.',
    '',
    '<details>',
    '<summary>Internal changes</summary>',
    '',
    '- **deps** — parser bump.',
    '',
    '</details>',
    '',
    '# [0.12.0](https://github.com/4gray/iptvnator/compare/v0.11.1...v0.12.0) (2023-03-11)',
    '',
    '### Bug Fixes',
    '',
    '- old entry',
].join('\n');

const internalOnlyChangelog = [
    '# 0.24.0 (2026-08-01)',
    '',
    '<details>',
    '<summary>Internal changes</summary>',
    '',
    '- **deps** — parser bump.',
    '',
    '</details>',
].join('\n');

describe('extractSection', () => {

    it('returns the section body without its own heading', () => {
        const section = extractSection(changelog, '0.24.0');

        assert.match(section, /^### Features/);
        assert.match(section, /Up Next rail/);
        assert.match(section, /<\/details>$/);
    });

    it('stops at the next release heading', () => {
        const section = extractSection(changelog, '0.24.0');

        assert.doesNotMatch(section, /0\.12\.0|old entry/);
    });

    it('matches the plain heading shape without a compare link', () => {
        const plain = '# 0.24.0 (2026-08-01)\n\n### Fixes\n\n- entry';

        assert.match(extractSection(plain, '0.24.0'), /^### Fixes/);
    });

    it('normalizes CRLF line endings in the extracted section', () => {
        const crlf =
            '# 0.24.0 (2026-08-01)\r\n\r\n### Fixes\r\n\r\n- entry\r\n';

        assert.equal(
            extractSection(crlf, '0.24.0'),
            '### Fixes\n\n- entry'
        );
    });

    it('does not match a different patch of the same minor', () => {
        assert.equal(extractSection(changelog, '0.24.1'), null);
    });

    it('returns null when the version is absent', () => {
        assert.equal(extractSection(changelog, '9.9.9'), null);
    });

    it('treats regex metacharacters in the version as literals', () => {
        // `.` must not act as a wildcard: 0x24y0 would match an unescaped 0.24.0
        assert.equal(extractSection('# 0x24y0 (2026-08-01)\n\n- e', '0.24.0'), null);
        // Injected pattern syntax must not throw or widen the match.
        assert.equal(extractSection(changelog, '0.24.0|0.12.0'), null);
        assert.equal(extractSection(changelog, '.*'), null);
        assert.equal(extractSection(changelog, '0.24\\.0'), null);
    });
});

describe('extractPublicSection', () => {
    it('strips the generated internal block from a mixed release', () => {
        assert.equal(
            extractPublicSection(changelog, '0.24.0'),
            '### Features\n\n- **playback** — Up Next rail.'
        );
    });

    it('keeps a public-only release unchanged', () => {
        const publicOnly = '# 0.24.0 (2026-08-01)\n\n### Fixes\n\n- Fixed it.';

        assert.equal(
            extractPublicSection(publicOnly, '0.24.0'),
            '### Fixes\n\n- Fixed it.'
        );
    });

    it('returns an empty string for an internal-only release', () => {
        assert.equal(extractPublicSection(internalOnlyChangelog, '0.24.0'), '');
    });

    it('preserves unrelated details blocks', () => {
        const release = [
            '# 0.24.0 (2026-08-01)',
            '',
            '<details>',
            '<summary>Migration guide</summary>',
            '',
            'Run the migration.',
            '',
            '</details>',
            '',
            '<details>',
            '<summary>Internal changes</summary>',
            '',
            '- **deps** — parser bump.',
            '',
            '</details>',
        ].join('\n');

        assert.equal(
            extractPublicSection(release, '0.24.0'),
            '<details>\n<summary>Migration guide</summary>\n\nRun the migration.\n\n</details>'
        );
    });

    it('preserves near-match internal summaries', () => {
        const release = [
            '# 0.24.0 (2026-08-01)',
            '',
            '<details>',
            '<summary>Internal changes </summary>',
            '',
            '- trailing space.',
            '',
            '</details>',
            '',
            '<details>',
            '<summary>internal changes</summary>',
            '',
            '- different case.',
            '',
            '</details>',
        ].join('\n');

        assert.equal(
            extractPublicSection(release, '0.24.0'),
            release.split('\n').slice(2).join('\n')
        );
    });
});

describe('extract-changelog-section CLI contracts', () => {
    it('uses public extraction for authored tag-release text', () => {
        const workflow = readFileSync(
            new URL(
                '../../.github/workflows/build-and-make.yaml',
                import.meta.url
            ),
            'utf8'
        );

        assert.match(
            workflow,
            /extract-changelog-section\.mjs --public "\$\{VERSION\}"/
        );
    });

    it('parses the public flag', () => {
        assert.deepEqual(parseExtractArguments(['--public', '0.24.0']), {
            version: '0.24.0',
            publicOnly: true,
        });
    });

    it('reports usage for invalid arguments', () => {
        for (const args of [
            [],
            ['0.24'],
            ['--unknown', '0.24.0'],
            ['--public', '--public', '0.24.0'],
            ['0.24.0', 'extra'],
        ]) {
            assert.equal(parseExtractArguments(args), null);
            const result = runExtractorCli(changelog, args);

            assert.equal(result.exitCode, 2);
            assert.equal(result.stdout, '');
            assert.match(result.stderr, /Usage:/);
        }
    });

    it('allows an empty public body for an internal-only release', () => {
        assert.deepEqual(
            runExtractorCli(internalOnlyChangelog, ['--public', '0.24.0']),
            { exitCode: 0, stdout: '', stderr: '' }
        );
    });

    it('validates process arguments before reading the changelog', () => {
        const result = runExtractorProcess(['--public'], () => {
            throw new Error('changelog should not be read');
        });

        assert.equal(result.exitCode, 2);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /Usage:/);
    });

    it('keeps raw process output and errors compatible', () => {
        assert.deepEqual(
            runExtractorProcess(['0.24.0'], () => '# 0.24.0 (2026-08-01)'),
            {
                exitCode: 1,
                stdout: '',
                stderr: 'CHANGELOG.md section for 0.24.0 is empty.\n',
            }
        );
        assert.deepEqual(
            runExtractorProcess(['9.9.9'], () => changelog),
            {
                exitCode: 1,
                stdout: '',
                stderr: [
                    'CHANGELOG.md has no section for 9.9.9.',
                    'The release flow writes it before tagging:',
                    '  pnpm run release:notes:changelog',
                    '  node tools/release/build-release-notes.mjs --consume',
                    'Commit the changelog, then re-tag.',
                    '',
                ].join('\n'),
            }
        );
        assert.deepEqual(
            runExtractorProcess(['0.24.0'], () => changelog),
            {
                exitCode: 0,
                stdout:
                    '### Features\n\n- **playback** — Up Next rail.\n\n<details>\n<summary>Internal changes</summary>\n\n- **deps** — parser bump.\n\n</details>\n',
                stderr: '',
            }
        );
    });

    it('normalizes CRLF output and appends exactly one trailing LF', () => {
        const crlf =
            '# 0.24.0 (2026-08-01)\r\n\r\n### Fixes\r\n\r\n- entry\r\n';
        const expected = {
            exitCode: 0,
            stdout: '### Fixes\n\n- entry\n',
            stderr: '',
        };

        assert.deepEqual(runExtractorCli(crlf, ['0.24.0']), expected);
        assert.deepEqual(
            runExtractorProcess(['0.24.0'], () => crlf),
            expected
        );
        assert.match(expected.stdout, /[^\n]\n$/);
        assert.doesNotMatch(expected.stdout, /\n\n$/);
    });

    it('reports the detailed missing-version diagnostic in public mode', () => {
        const expected = {
            exitCode: 1,
            stdout: '',
            stderr: [
                'CHANGELOG.md has no section for 9.9.9.',
                'The release flow writes it before tagging:',
                '  pnpm run release:notes:changelog',
                '  node tools/release/build-release-notes.mjs --consume',
                'Commit the changelog, then re-tag.',
                '',
            ].join('\n'),
        };

        assert.deepEqual(
            runExtractorCli(changelog, ['--public', '9.9.9']),
            expected
        );
        assert.deepEqual(
            runExtractorProcess(['--public', '9.9.9'], () => changelog),
            expected
        );
    });
});

describe('helpers', () => {
    it('formats dates and release slugs', () => {
        assert.equal(formatLongDate('2026-08-01'), 'August 1, 2026');
        assert.equal(releaseSlug('0.24.0'), 'v0-24');
    });
});
