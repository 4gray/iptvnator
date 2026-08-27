/**
 * Pure layout layer for release highlight cards: plans which cards a release
 * gets from its `highlight:` notes and builds the SVG for each. Rendering to
 * PNG (sharp) lives in generate-highlight-cards.mjs; everything here is
 * deterministic string work, so it is unit-testable without an image library.
 *
 * Card size is the 1200×630 Open Graph format — right for Telegram/Reddit
 * link previews and reusable as a blog hero.
 */

import path from 'node:path';

import { groupNotes } from './release-notes.mjs';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** Screenshot strip: fills the card bottom under the text block. */
export const SHOT_WIDTH = 880;
export const SHOT_TOP = 330;
export const SHOT_LEFT = (CARD_WIDTH - SHOT_WIDTH) / 2;
export const SHOT_RADIUS = 14;

/** Feature-card text block, laid out to always clear the screenshot frame. */
const HEADLINE_TOP = 168;
const HEADLINE_LINE_HEIGHT = 58;
const BODY_LINE_HEIGHT = 32;
const BODY_GAP = 8;
/** Lowest permitted body baseline: the frame starts at SHOT_TOP - 2. */
export const TEXT_BOTTOM = SHOT_TOP - 24;

const BRAND = {
    backgroundTop: '#0a0a08',
    backgroundBottom: '#141412',
    text: '#f0f0eb',
    muted: '#8a8a80',
    accent: '#20a8a8',
    accentBright: '#38c4c4',
    warm: '#d4a853',
    frame: '#2e2e28',
};

const FONT_STACK = "'DM Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Human count labels for the hero footer, singular and plural. */
const COUNT_LABELS = {
    breaking: ['breaking change', 'breaking changes'],
    feature: ['feature', 'features'],
    fix: ['fix', 'fixes'],
    perf: ['performance win', 'performance wins'],
};

export function escapeXml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Greedy word wrap by character budget. SVG has no automatic text layout and
 * font metrics vary by host, so the budget is conservative.
 *
 * Every returned line is at most `maxChars` long, including when a single
 * word exceeds the budget: such a word is broken at the budget rather than
 * left whole. Leaving it whole is what a naive wrap does, and a 60-character
 * unbroken headline — well inside the validated limit — then rendered past
 * the edge of the 1200px card and was cropped.
 *
 * @param {string} text
 * @param {number} maxChars
 * @param {number} maxLines
 * @returns {string[]} at most maxLines lines, the last one ellipsized on overflow
 */
export function wrapText(text, maxChars, maxLines) {
    const words = text.replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
        if (word.length > maxChars) {
            if (current) {
                lines.push(current);
            }

            for (let start = 0; start < word.length; start += maxChars) {
                lines.push(word.slice(start, start + maxChars));
            }

            // Keep the final chunk open so a following short word can join it.
            current = lines.pop() ?? '';
            continue;
        }

        const candidate = current ? `${current} ${word}` : word;

        if (candidate.length <= maxChars || !current) {
            current = candidate;
            continue;
        }

        lines.push(current);
        current = word;
    }

    if (current) {
        lines.push(current);
    }

    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        const last = kept[maxLines - 1];

        kept[maxLines - 1] =
            `${last.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;

        return kept;
    }

    return lines;
}

/**
 * One card per `highlight:` note, plus one release hero card. The screenshot
 * (when the note names one) is read from the published blog directory the
 * capture run writes to, in the requested theme.
 *
 * @param {object[]} notes parsed `.changes` notes
 * @param {{ version: string, releaseSlug: string, screenshotsDir: string, theme: string }} options
 * @returns {{ feature: object[], publicNoteCount: number, hero: object }}
 */
export function planHighlightCards(notes, options) {
    const { version, releaseSlug, screenshotsDir, theme } = options;
    const ordered = groupNotes(notes)
        .filter((group) => group.type !== 'internal')
        .flatMap((group) => group.notes);
    const highlights = ordered.filter((note) => note.highlight);

    const takenSlugs = new Set();

    const feature = highlights.map((note) => {
        // Named after the note file, never the screenshot slug: filenames are
        // unique within `.changes/`, while two highlights may legitimately
        // point at the same manifest shot — naming cards after it would let
        // one silently overwrite the other.
        const base = cardSlug(path.basename(note.sourcePath, '.md'));
        // Normalizing can collapse two distinct names onto one, so uniqueness
        // is re-established here rather than assumed.
        let slug = base;

        for (let suffix = 2; takenSlugs.has(slug); suffix += 1) {
            slug = `${base}-${suffix}`;
        }

        takenSlugs.add(slug);

        return {
            slug,
            fileName: `card-${slug}.png`,
            headline: note.highlight,
            body: note.body,
            screenshotPath: note.screenshot
                ? path.join(screenshotsDir, `${note.screenshot}-${theme}.png`)
                : null,
        };
    });

    const counts = groupNotes(ordered)
        .map((group) => {
            const [singular, plural] = COUNT_LABELS[group.type];

            return `${group.notes.length} ${group.notes.length === 1 ? singular : plural}`;
        })
        .join(' · ');

    return {
        feature,
        // Public notes, not total: an internal-only release has nothing to put
        // on a card, which is a legal release shape rather than an error.
        publicNoteCount: ordered.length,
        hero: {
            fileName: 'hero.png',
            version,
            releaseSlug,
            headlines: highlights.map((note) => note.highlight),
            counts,
        },
    };
}

/** Files this generator owns in an output directory. */
export function isOwnedCardFile(fileName) {
    return (
        /^card-[a-z0-9-]+\.png$/.test(fileName) ||
        fileName === 'hero.png' ||
        fileName === 'hero.jpg'
    );
}

/**
 * Every emitted filename must satisfy isOwnedCardFile(), or a later run cannot
 * reclaim the card it wrote. Note filenames are conventionally lowercase slugs
 * but nothing enforces it, so normalize rather than trust: `player_new-ui.md`
 * would otherwise produce a card no cleanup pass can ever remove.
 *
 * @param {string} noteBaseName note filename without its `.md` extension
 * @returns {string}
 */
export function cardSlug(noteBaseName) {
    const normalized = noteBaseName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return normalized || 'note';
}

function backgroundDefs() {
    return [
        '<defs>',
        `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">`,
        `<stop offset="0" stop-color="${BRAND.backgroundTop}"/>`,
        `<stop offset="1" stop-color="${BRAND.backgroundBottom}"/>`,
        '</linearGradient>',
        `<radialGradient id="glow" cx="0.85" cy="0.1" r="0.9">`,
        `<stop offset="0" stop-color="${BRAND.accent}" stop-opacity="0.16"/>`,
        `<stop offset="1" stop-color="${BRAND.accent}" stop-opacity="0"/>`,
        '</radialGradient>',
        '</defs>',
    ].join('');
}

function backgroundRects() {
    return [
        `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bg)"/>`,
        `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#glow)"/>`,
    ].join('');
}

function brandHeader(version) {
    const chipX = 262;

    return [
        `<text x="64" y="84" font-family="${FONT_STACK}" font-size="34" font-weight="700" fill="${BRAND.text}">IPTVnator</text>`,
        `<rect x="${chipX}" y="56" rx="16" ry="16" width="${34 + `v${version}`.length * 13}" height="36" fill="none" stroke="${BRAND.accent}" stroke-width="2"/>`,
        `<text x="${chipX + 17}" y="81" font-family="${FONT_STACK}" font-size="22" font-weight="600" fill="${BRAND.accentBright}">v${escapeXml(version)}</text>`,
    ].join('');
}

function textLines(lines, { x, y, size, weight, fill, lineHeight }) {
    return lines
        .map(
            (line, index) =>
                `<text x="${x}" y="${y + index * lineHeight}" font-family="${FONT_STACK}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`
        )
        .join('');
}

/**
 * Feature card: brand header, headline, muted body one-liner, and either a
 * framed screenshot strip along the bottom or (without a screenshot) an
 * accent rule under a larger, vertically centered headline.
 *
 * @param {object} job entry from planHighlightCards().feature
 * @param {string} version
 * @returns {string} SVG document; the screenshot itself is composited by the
 * renderer inside the frame this SVG draws
 */
export function buildFeatureCardSvg(job, version) {
    const parts = [
        `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
        backgroundDefs(),
        backgroundRects(),
        brandHeader(version),
    ];

    if (job.screenshotPath) {
        const headline = wrapText(job.headline, 34, 2);
        // The body's line budget is derived from the space actually left above
        // the screenshot frame, never assumed: the frame is opaque and painted
        // after the text, so a fixed line count silently sliced the last line
        // in half whenever the headline wrapped to two lines.
        const bodyTop =
            HEADLINE_TOP + headline.length * HEADLINE_LINE_HEIGHT + BODY_GAP;
        const bodyLines = Math.max(
            1,
            Math.min(
                3,
                Math.floor((TEXT_BOTTOM - bodyTop) / BODY_LINE_HEIGHT) + 1
            )
        );
        const body = wrapText(job.body, 88, bodyLines);

        parts.push(
            textLines(headline, {
                x: 64,
                y: HEADLINE_TOP,
                size: 52,
                weight: 800,
                fill: BRAND.text,
                lineHeight: HEADLINE_LINE_HEIGHT,
            })
        );
        parts.push(
            textLines(body, {
                x: 64,
                y: bodyTop,
                size: 23,
                weight: 400,
                fill: BRAND.muted,
                lineHeight: BODY_LINE_HEIGHT,
            })
        );
        // Frame stroke sits behind the composited screenshot; the strip is
        // bottom-cropped by the canvas, so only the top corners round.
        parts.push(
            `<rect x="${SHOT_LEFT - 2}" y="${SHOT_TOP - 2}" width="${SHOT_WIDTH + 4}" height="${CARD_HEIGHT - SHOT_TOP + 4}" rx="${SHOT_RADIUS + 2}" fill="${BRAND.frame}"/>`
        );
    } else {
        const headline = wrapText(job.headline, 30, 2);
        const body = wrapText(job.body, 74, 3);
        const headlineY = 250;

        parts.push(
            textLines(headline, {
                x: 64,
                y: headlineY,
                size: 62,
                weight: 800,
                fill: BRAND.text,
                lineHeight: 74,
            })
        );
        parts.push(
            `<rect x="64" y="${headlineY + headline.length * 74 - 44}" width="120" height="6" rx="3" fill="${BRAND.warm}"/>`
        );
        parts.push(
            textLines(body, {
                x: 64,
                y: headlineY + headline.length * 74 + 8,
                size: 26,
                weight: 400,
                fill: BRAND.muted,
                lineHeight: 38,
            })
        );
    }

    parts.push('</svg>');

    return parts.join('');
}

/**
 * Hero card: big version, the highlight names as an accent-bulleted list,
 * and the per-type note counts along the bottom.
 *
 * @param {object} hero planHighlightCards().hero
 * @returns {string}
 */
export function buildHeroCardSvg(hero) {
    const listed = hero.headlines.slice(0, 4);
    const omitted = hero.headlines.length - listed.length;
    const parts = [
        `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
        backgroundDefs(),
        backgroundRects(),
        `<text x="64" y="96" font-family="${FONT_STACK}" font-size="34" font-weight="700" fill="${BRAND.text}">IPTVnator</text>`,
        `<text x="64" y="220" font-family="${FONT_STACK}" font-size="104" font-weight="800" fill="${BRAND.text}">v${escapeXml(hero.version)}</text>`,
        `<rect x="64" y="252" width="160" height="6" rx="3" fill="${BRAND.warm}"/>`,
    ];

    listed.forEach((headline, index) => {
        const y = 330 + index * 56;

        parts.push(
            `<circle cx="74" cy="${y - 10}" r="6" fill="${BRAND.accentBright}"/>`
        );
        // wrapText yields no lines for whitespace-only input; validation
        // rejects that upstream, but a card run must not die half-written.
        const [line = ''] = wrapText(headline, 60, 1);

        parts.push(
            `<text x="100" y="${y}" font-family="${FONT_STACK}" font-size="30" font-weight="600" fill="${BRAND.text}">${escapeXml(line)}</text>`
        );
    });

    if (omitted > 0) {
        parts.push(
            `<text x="100" y="${330 + listed.length * 56}" font-family="${FONT_STACK}" font-size="26" fill="${BRAND.muted}">…and ${omitted} more</text>`
        );
    }

    if (hero.counts) {
        parts.push(
            `<text x="64" y="${CARD_HEIGHT - 48}" font-family="${FONT_STACK}" font-size="24" fill="${BRAND.muted}">${escapeXml(hero.counts)}</text>`
        );
    }

    parts.push('</svg>');

    return parts.join('');
}

/**
 * Rounded-corner alpha mask for the screenshot strip (dest-in composite).
 *
 * @param {number} width
 * @param {number} height
 * @returns {string}
 */
export function buildShotMaskSvg(width, height) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="${width}" height="${height}" rx="${SHOT_RADIUS}" fill="#fff"/></svg>`;
}
