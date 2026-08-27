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

/** Left margin, and the width text may occupy before the right margin. */
const TEXT_LEFT = 64;
export const TEXT_MAX_WIDTH = CARD_WIDTH - TEXT_LEFT * 2;
/** Hero bullet lines start further right, after the accent dot. */
const HERO_BULLET_LEFT = 100;
export const HERO_BULLET_MAX_WIDTH = CARD_WIDTH - HERO_BULLET_LEFT - TEXT_LEFT;

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
 * Per-character advance width as a fraction of the font size.
 *
 * Counting characters is not a width budget: 34 `W` at font-size 52 measures
 * ~1948px where only ~1072px are available, so a character-capped line still
 * overflowed the canvas. These factors are calibrated against that measured
 * bold rendering and deliberately err high — over-estimating wraps a line
 * early, which is invisible; under-estimating crops the card.
 */
const WIDE_GLYPHS = new Set('MWmw@%ЖШЩбюфЮ');
const NARROW_GLYPHS = new Set("iljItfrJ.,;:'\"`!|()[]{}/\\-ЁІ");

/**
 * @param {string} text
 * @param {number} fontSize
 * @returns {number} estimated rendered width in pixels
 */
export function estimateTextWidth(text, fontSize) {
    let units = 0;

    for (const character of text) {
        if (character === ' ') {
            units += 0.3;
        } else if (NARROW_GLYPHS.has(character)) {
            units += 0.35;
        } else if (WIDE_GLYPHS.has(character)) {
            units += 1.1;
        } else if (character === character.toUpperCase() && character !== character.toLowerCase()) {
            units += 0.78;
        } else {
            units += 0.6;
        }
    }

    return units * fontSize;
}

/** Splits one overlong word into chunks that each fit `maxWidth`. */
function breakWord(word, maxWidth, fontSize) {
    const chunks = [];
    let chunk = '';

    for (const character of word) {
        if (
            chunk &&
            estimateTextWidth(chunk + character, fontSize) > maxWidth
        ) {
            chunks.push(chunk);
            chunk = character;
            continue;
        }

        chunk += character;
    }

    if (chunk) {
        chunks.push(chunk);
    }

    return chunks;
}

/**
 * Greedy word wrap by estimated rendered width. SVG has no automatic text
 * layout, so the wrap has to decide the breaks itself; every returned line is
 * estimated to fit `maxWidth`, including when a single word does not — such a
 * word is broken rather than left to run off the canvas.
 *
 * @param {string} text
 * @param {{ maxWidth: number, fontSize: number, maxLines: number }} options
 * @returns {string[]} at most maxLines lines, the last ellipsized on overflow
 */
export function wrapText(text, { maxWidth, fontSize, maxLines }) {
    const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let current = '';

    for (const word of words) {
        if (estimateTextWidth(word, fontSize) > maxWidth) {
            if (current) {
                lines.push(current);
            }

            lines.push(...breakWord(word, maxWidth, fontSize));
            // Keep the final chunk open so a following short word can join it.
            current = lines.pop() ?? '';
            continue;
        }

        const candidate = current ? `${current} ${word}` : word;

        if (!current || estimateTextWidth(candidate, fontSize) <= maxWidth) {
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
        let last = kept[maxLines - 1];

        while (
            last.length > 1 &&
            estimateTextWidth(`${last}…`, fontSize) > maxWidth
        ) {
            last = last.slice(0, -1);
        }

        kept[maxLines - 1] = `${last.trimEnd()}…`;

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

/**
 * `maxWidth` is a hard backstop, not the wrap budget: the wrap already fits
 * every line by estimate, and this clamps anything the estimate got wrong so
 * a mis-measured glyph compresses instead of running off the canvas.
 */
function textLines(lines, { x, y, size, weight, fill, lineHeight, maxWidth }) {
    return lines
        .map((line, index) => {
            const clamp =
                maxWidth && estimateTextWidth(line, size) > maxWidth
                    ? ` textLength="${maxWidth}" lengthAdjust="spacingAndGlyphs"`
                    : '';

            return `<text x="${x}" y="${y + index * lineHeight}" font-family="${FONT_STACK}" font-size="${size}" font-weight="${weight}" fill="${fill}"${clamp}>${escapeXml(line)}</text>`;
        })
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
        const headline = wrapText(job.headline, {
            maxWidth: TEXT_MAX_WIDTH,
            fontSize: 52,
            maxLines: 2,
        });
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
        const body = wrapText(job.body, {
            maxWidth: TEXT_MAX_WIDTH,
            fontSize: 23,
            maxLines: bodyLines,
        });

        parts.push(
            textLines(headline, {
                x: TEXT_LEFT,
                y: HEADLINE_TOP,
                size: 52,
                weight: 800,
                fill: BRAND.text,
                lineHeight: HEADLINE_LINE_HEIGHT,
                maxWidth: TEXT_MAX_WIDTH,
            })
        );
        parts.push(
            textLines(body, {
                x: TEXT_LEFT,
                y: bodyTop,
                size: 23,
                weight: 400,
                fill: BRAND.muted,
                lineHeight: BODY_LINE_HEIGHT,
                maxWidth: TEXT_MAX_WIDTH,
            })
        );
        // Frame stroke sits behind the composited screenshot; the strip is
        // bottom-cropped by the canvas, so only the top corners round.
        parts.push(
            `<rect x="${SHOT_LEFT - 2}" y="${SHOT_TOP - 2}" width="${SHOT_WIDTH + 4}" height="${CARD_HEIGHT - SHOT_TOP + 4}" rx="${SHOT_RADIUS + 2}" fill="${BRAND.frame}"/>`
        );
    } else {
        const headline = wrapText(job.headline, {
            maxWidth: TEXT_MAX_WIDTH,
            fontSize: 62,
            maxLines: 2,
        });
        const body = wrapText(job.body, {
            maxWidth: TEXT_MAX_WIDTH,
            fontSize: 26,
            maxLines: 3,
        });
        const headlineY = 250;

        parts.push(
            textLines(headline, {
                x: TEXT_LEFT,
                y: headlineY,
                size: 62,
                weight: 800,
                fill: BRAND.text,
                lineHeight: 74,
                maxWidth: TEXT_MAX_WIDTH,
            })
        );
        parts.push(
            `<rect x="${TEXT_LEFT}" y="${headlineY + headline.length * 74 - 44}" width="120" height="6" rx="3" fill="${BRAND.warm}"/>`
        );
        parts.push(
            textLines(body, {
                x: TEXT_LEFT,
                y: headlineY + headline.length * 74 + 8,
                size: 26,
                weight: 400,
                fill: BRAND.muted,
                lineHeight: 38,
                maxWidth: TEXT_MAX_WIDTH,
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
        const [line = ''] = wrapText(headline, {
            maxWidth: HERO_BULLET_MAX_WIDTH,
            fontSize: 30,
            maxLines: 1,
        });

        parts.push(
            textLines([line], {
                x: HERO_BULLET_LEFT,
                y,
                size: 30,
                weight: 600,
                fill: BRAND.text,
                lineHeight: 0,
                maxWidth: HERO_BULLET_MAX_WIDTH,
            })
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
