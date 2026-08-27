import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    renderRedditPost,
    renderTelegramPost,
    splitHighlights,
    TELEGRAM_MESSAGE_LIMIT,
} from './release-announcements.mjs';

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

describe('splitHighlights', () => {
    it('separates highlight notes from the rest in group order', () => {
        const { highlights, rest } = splitHighlights([
            note({ type: 'fix', body: 'Fixed resume.' }),
            note({ highlight: 'Up Next rail' }),
            note({
                type: 'breaking',
                highlight: 'New settings layout',
                body: 'Settings moved.',
            }),
        ]);

        // breaking sorts before feature regardless of input order
        assert.deepEqual(
            highlights.map((entry) => entry.highlight),
            ['New settings layout', 'Up Next rail']
        );
        assert.deepEqual(
            rest.map((entry) => entry.body),
            ['Fixed resume.']
        );
    });

    it('drops internal notes entirely', () => {
        const { highlights, rest } = splitHighlights([
            note({ type: 'internal', body: 'Split the store.' }),
        ]);

        assert.deepEqual(highlights, []);
        assert.deepEqual(rest, []);
    });
});

describe('renderTelegramPost', () => {
    it('leads with highlights and compresses the rest into a counter', () => {
        const post = renderTelegramPost(
            [
                note({ highlight: 'Up Next rail' }),
                note({ type: 'fix', body: 'Stalker resume works again.' }),
                note({ type: 'fix', body: 'EPG no longer flickers.' }),
            ],
            { version: '0.24.0' }
        );

        assert.match(post, /^🎉 IPTVnator v0\.24\.0 is out!/);
        assert.match(
            post,
            /✨ Up Next rail — Series now show an Up Next rail beside the player\./
        );
        assert.match(post, /…plus 2 more fixes and improvements\./);
        assert.doesNotMatch(post, /Stalker resume|EPG no longer/);
        assert.match(
            post,
            /⬇️ Download: https:\/\/github\.com\/4gray\/iptvnator\/releases\/tag\/v0\.24\.0/
        );
        assert.match(
            post,
            /📝 Full notes: https:\/\/4gray\.github\.io\/iptvnator\/blog\/v0-24-release-notes\//
        );
    });

    it('uses the singular counter line for one hidden change', () => {
        const post = renderTelegramPost(
            [
                note({ highlight: 'Up Next rail' }),
                note({ type: 'fix', body: 'Stalker resume works again.' }),
            ],
            { version: '0.24.0' }
        );

        assert.match(post, /…plus 1 more fix or improvement\./);
    });

    it('lists all changes when no note is highlighted', () => {
        const post = renderTelegramPost(
            [
                note({ type: 'fix', body: 'Stalker resume works again.' }),
                note({ type: 'perf', body: 'Playlists import faster.' }),
            ],
            { version: '0.24.1' }
        );

        assert.match(post, /🔧 Stalker resume works again\./);
        assert.match(post, /⚡ Playlists import faster\./);
        assert.doesNotMatch(post, /…plus/);
    });

    it('omits internal notes and stays inside the Telegram limit', () => {
        const notes = Array.from({ length: 120 }, (_, index) =>
            note({
                type: 'fix',
                body: `Fix number ${index}: ${'detail '.repeat(10)}.`,
                sourcePath: `.changes/fix-${index}.md`,
            })
        );
        notes.push(note({ type: 'internal', body: 'Internal churn.' }));

        const post = renderTelegramPost(notes, { version: '0.24.0' });

        assert.ok(post.length <= TELEGRAM_MESSAGE_LIMIT);
        assert.doesNotMatch(post, /Internal churn/);
        assert.match(post, /…plus \d+ more fixes and improvements\./);
    });

    it('never folds a breaking change into the counter', () => {
        const post = renderTelegramPost(
            [
                note({ highlight: 'Up Next rail' }),
                note({
                    type: 'breaking',
                    body: 'Legacy playlist storage is removed.',
                }),
                note({ type: 'fix', body: 'Stalker resume works again.' }),
            ],
            { version: '0.24.0' }
        );

        assert.match(post, /⚠️ Legacy playlist storage is removed\./);
        assert.match(post, /…plus 1 more fix or improvement\./);
        assert.doesNotMatch(post, /Stalker resume/);
    });

    it('returns null for an internal-only release instead of throwing', () => {
        assert.equal(
            renderTelegramPost([note({ type: 'internal' })], {
                version: '0.24.0',
            }),
            null
        );
    });

    it('refuses to silently drop a hand-picked highlight', () => {
        const notes = Array.from({ length: 30 }, (_, index) =>
            note({
                highlight: `Feature ${index} with quite a long headline text`,
                body: `${'Very long body copy. '.repeat(15)}`,
                sourcePath: `.changes/feature-${index}.md`,
            })
        );

        assert.throws(
            () => renderTelegramPost(notes, { version: '0.24.0' }),
            /do not fit Telegram's 4096-character limit/
        );
    });
});

describe('renderRedditPost', () => {
    it('suggests a title, sections the highlights and collapses the rest', () => {
        const post = renderRedditPost(
            [
                note({ highlight: 'Up Next rail' }),
                note({ type: 'fix', area: 'stalker', body: 'Resume works.' }),
            ],
            { version: '0.24.0' }
        );

        assert.match(post, /^Suggested title: IPTVnator v0\.24\.0 — Up Next rail\n/);
        assert.match(post, /## Highlights/);
        assert.match(
            post,
            /### Up Next rail\n\nSeries now show an Up Next rail beside the player\./
        );
        assert.match(post, /## Also in this release/);
        assert.match(post, /\*\*Fixes\*\*\n\n- \*\*stalker\*\* — Resume works\./);
        assert.match(
            post,
            /\[Download\]\(https:\/\/github\.com\/4gray\/iptvnator\/releases\/tag\/v0\.24\.0\)/
        );
        assert.match(
            post,
            /\[Full release notes\]\(https:\/\/4gray\.github\.io\/iptvnator\/blog\/v0-24-release-notes\/\)/
        );
    });

    it('falls back to a plain title and full list without highlights', () => {
        const post = renderRedditPost(
            [note({ type: 'fix', body: 'Resume works.' })],
            { version: '0.24.1' }
        );

        assert.match(post, /^Suggested title: IPTVnator v0\.24\.1 released\n/);
        assert.match(post, /## What's changed/);
        assert.doesNotMatch(post, /## Highlights/);
    });

    it('omits internal notes', () => {
        const post = renderRedditPost(
            [note(), note({ type: 'internal', body: 'Internal churn.' })],
            { version: '0.24.0' }
        );

        assert.doesNotMatch(post, /Internal churn/);
    });

    it('returns null for an internal-only release', () => {
        assert.equal(
            renderRedditPost([note({ type: 'internal' })], {
                version: '0.24.0',
            }),
            null
        );
    });

    it('links the patch blog post to its minor release page', () => {
        const post = renderRedditPost([note()], { version: '0.24.2' });

        assert.match(post, /blog\/v0-24-release-notes\//);
    });
});
