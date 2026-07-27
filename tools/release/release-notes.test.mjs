import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    formatLongDate,
    releaseSlug,
    renderBlogScaffold,
    renderChangelogSection,
    renderGithubBody,
    upsertChangelogSection,
} from './release-notes-render.mjs';
import { extractSection } from './extract-changelog-section.mjs';

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

describe('renderBlogScaffold', () => {
    it('emits a draft with TODO markers and a release meta block', () => {
        const content = renderBlogScaffold([note()], {
            version: '0.24.0',
            date: '2026-08-01',
        });

        assert.match(content, /^---\ntitle: v0\.24 - Release Notes/);
        assert.match(content, /draft: true/);
        assert.match(content, /TODO/);
        assert.match(content, /releaseDate="August 1, 2026"/);
    });

    it('gives screenshot notes their own section with a dark/light slider', () => {
        const content = renderBlogScaffold(
            [note({ screenshot: 'up-next-rail' })],
            { version: '0.24.0', date: '2026-08-01' }
        );

        assert.match(content, /### TODO headline \(playback\)/);
        assert.match(
            content,
            /\/iptvnator\/blog\/v0-24\/screenshots\/up-next-rail-dark\.png/
        );
        assert.match(
            content,
            /\/iptvnator\/blog\/v0-24\/screenshots\/up-next-rail-light\.png/
        );
    });

    it('truncates a long body for image alt text without cutting mid-word', () => {
        const body = `${'Series show the rest of the season beside the player '.repeat(4)}now.`;
        const content = renderBlogScaffold(
            [note({ body, screenshot: 'up-next-rail' })],
            { version: '0.24.0', date: '2026-08-01' }
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
            { version: '0.24.0', date: '2026-08-01' }
        );
        const alt = content.match(/alt: '(.*)',/)[1];

        assert.match(alt, /C:\\\\Users/);
        assert.match(alt, /app\\'s/);
        // An odd number of trailing backslashes would escape the closing quote.
        assert.doesNotMatch(alt, /(^|[^\\])(\\\\)*\\$/);
    });

    it('escapes characters MDX would parse as markup', () => {
        const content = renderBlogScaffold(
            [note({ body: 'Channels named <live> and {vod} now sort correctly.' })],
            { version: '0.24.0', date: '2026-08-01' }
        );

        assert.doesNotMatch(content, /<live>/);
        assert.doesNotMatch(content, /\{vod\}/);
        assert.match(content, /&lt;live&gt;/);
        assert.match(content, /&#123;vod&#125;/);
    });

    it('imports only the components it emits', () => {
        const content = renderBlogScaffold([note()], {
            version: '0.24.0',
            date: '2026-08-01',
        });

        assert.match(content, /import ReleaseMeta from/);
        assert.match(content, /import BlogImageSlider from/);
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

describe('extractSection', () => {
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

describe('helpers', () => {
    it('formats dates and release slugs', () => {
        assert.equal(formatLongDate('2026-08-01'), 'August 1, 2026');
        assert.equal(releaseSlug('0.24.0'), 'v0-24');
    });
});
