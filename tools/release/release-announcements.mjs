/**
 * Announcement renderers: compact release posts for Telegram and Reddit.
 *
 * Both formats are built around `highlight:` notes — the two or three changes
 * worth leading with — and compress everything else into a counter (Telegram)
 * or a collapsed list (Reddit). `internal` notes never appear.
 *
 * Output goes to stdout so it can be piped or pasted; publishing is a human
 * act, these scripts never talk to any social platform.
 */

import { groupNotes, REPO_URL } from './release-notes.mjs';
import { releaseSlug } from './release-notes-render.mjs';

export const WEBSITE_URL = 'https://4gray.github.io/iptvnator';

/**
 * Telegram truncates nothing — it rejects messages over 4096 characters, so
 * the renderer must guarantee the limit instead of hoping.
 */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

const TYPE_EMOJI = {
    breaking: '⚠️',
    feature: '✨',
    fix: '🔧',
    perf: '⚡',
};

/** Collapses a note body to a single line. */
function oneLine(body) {
    return body.replace(/\s+/g, ' ').trim();
}

function releaseUrl(version) {
    return `${REPO_URL}/releases/tag/v${version}`;
}

/** One blog post per minor version, same rule as the blog scaffold. */
function blogUrl(version) {
    return `${WEBSITE_URL}/blog/${releaseSlug(version)}-release-notes/`;
}

/**
 * Splits notes into the announcement-worthy highlights and the remaining
 * user-visible changes. Group order (breaking → feature → fix → perf) is
 * preserved inside both halves; `internal` is dropped entirely.
 *
 * @param {object[]} notes
 * @returns {{ ordered: object[], highlights: object[], rest: object[] }}
 */
export function splitHighlights(notes) {
    const ordered = groupNotes(notes)
        .filter((group) => group.type !== 'internal')
        .flatMap((group) => group.notes);

    return {
        ordered,
        highlights: ordered.filter((note) => note.highlight),
        rest: ordered.filter((note) => !note.highlight),
    };
}

function moreLine(count) {
    return count === 1
        ? '…plus 1 more fix or improvement.'
        : `…plus ${count} more fixes and improvements.`;
}

/**
 * Plain text on purpose: Telegram markdown is a bot-API entity format, and a
 * hand-pasted post renders literal `*`/`[` characters. Bare URLs unfurl fine.
 *
 * @param {object[]} notes
 * @param {{ version: string }} options
 * @returns {string | null} a post guaranteed to fit TELEGRAM_MESSAGE_LIMIT,
 * or null for an internal-only release with nothing public to announce
 */
export function renderTelegramPost(notes, { version }) {
    const { ordered, highlights, rest } = splitHighlights(notes);
    const leadIsHighlights = highlights.length > 0;
    // A breaking change is never folded into the counter, highlighted or not:
    // announcing one as "fixes and improvements" is worse than a longer post.
    const lead = leadIsHighlights
        ? ordered.filter((note) => note.highlight || note.type === 'breaking')
        : rest;

    // An internal-only release is a legal shape — its authored GitHub body is
    // empty too — and there is simply nothing to announce publicly.
    if (lead.length === 0) {
        return null;
    }

    const footer = [
        `⬇️ Download: ${releaseUrl(version)}`,
        `📝 Full notes: ${blogUrl(version)}`,
    ].join('\n');

    const buildPost = (visibleLead) => {
        const lines = visibleLead.map((note) => {
            const emoji = TYPE_EMOJI[note.type] ?? '•';
            const body = oneLine(note.body);

            return note.highlight
                ? `${emoji} ${note.highlight} — ${body}`
                : `${emoji} ${body}`;
        });

        // Everything public that this post does not spell out.
        const hiddenCount = ordered.length - visibleLead.length;
        const more = hiddenCount > 0 ? moreLine(hiddenCount) : null;

        return [
            `🎉 IPTVnator v${version} is out!`,
            lines.join('\n'),
            more,
            footer,
        ]
            .filter(Boolean)
            .join('\n\n');
    };

    // Drop trailing entries into the counter until the post fits. Two classes
    // of entry are never allowed to fall in there: hand-picked highlights
    // (the release manager chose too many) and breaking changes (a warning
    // silently reported as "fixes and improvements" is worse than no post).
    for (let visible = lead.length; visible > 0; visible -= 1) {
        const post = buildPost(lead.slice(0, visible));

        if (post.length > TELEGRAM_MESSAGE_LIMIT) {
            continue;
        }

        const dropped = lead.slice(visible);
        const droppedBreaking = dropped.filter(
            (note) => note.type === 'breaking'
        ).length;

        if (droppedBreaking > 0) {
            throw new Error(
                `${droppedBreaking} breaking change(s) do not fit Telegram's ${TELEGRAM_MESSAGE_LIMIT}-character limit — shorten those notes, or announce this release in several posts`
            );
        }

        if (leadIsHighlights && dropped.length > 0) {
            throw new Error(
                `the ${lead.length} highlights do not fit Telegram's ${TELEGRAM_MESSAGE_LIMIT}-character limit — pick fewer or shorten their notes`
            );
        }

        return post;
    }

    throw new Error(
        `even a single entry exceeds Telegram's ${TELEGRAM_MESSAGE_LIMIT}-character limit`
    );
}

/**
 * Reddit post: markdown body plus a suggested title on the first line,
 * because Reddit takes the title separately from the body.
 *
 * @param {object[]} notes
 * @param {{ version: string }} options
 * @returns {string | null} null for an internal-only release
 */
export function renderRedditPost(notes, { version }) {
    const { highlights, rest } = splitHighlights(notes);

    if (highlights.length === 0 && rest.length === 0) {
        return null;
    }

    const title =
        highlights.length > 0
            ? `IPTVnator v${version} — ${highlights.map((note) => note.highlight).join(', ')}`
            : `IPTVnator v${version} released`;

    const blocks = [`Suggested title: ${title}`, '---'];

    if (highlights.length > 0) {
        blocks.push('## Highlights');

        for (const note of highlights) {
            blocks.push(`### ${note.highlight}`, oneLine(note.body));
        }
    }

    if (rest.length > 0) {
        blocks.push(
            highlights.length > 0
                ? '## Also in this release'
                : "## What's changed"
        );

        for (const group of groupNotes(rest)) {
            const entries = group.notes
                .map((note) => `- **${note.area}** — ${oneLine(note.body)}`)
                .join('\n');

            blocks.push(`**${group.heading}**\n\n${entries}`);
        }
    }

    blocks.push(
        `[Download](${releaseUrl(version)}) · [Full release notes](${blogUrl(version)}) · [Changelog](${REPO_URL}/blob/master/CHANGELOG.md)`
    );

    return `${blocks.filter(Boolean).join('\n\n')}\n`;
}
