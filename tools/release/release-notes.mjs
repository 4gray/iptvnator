/**
 * Parsing and validation for `.changes/*.md` release notes.
 *
 * One file per user-visible change, written by the PR author while the
 * context is still fresh. The generator (build-release-notes.mjs) turns the
 * accumulated files into the GitHub release body, the CHANGELOG.md section,
 * the website blog scaffold, and the Telegram/Reddit announcement drafts.
 *
 * Deliberately dependency-free: a hand-rolled parser for this tiny, closed
 * schema is more predictable than a YAML engine, and it can reject unknown
 * keys — which is what catches agent typos.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_URL = 'https://github.com/4gray/iptvnator';

/** Render order. `internal` is last and is excluded from user-facing output. */
export const NOTE_TYPES = ['breaking', 'feature', 'fix', 'perf', 'internal'];

export const TYPE_HEADINGS = {
    breaking: 'Breaking changes',
    feature: 'Features',
    fix: 'Fixes',
    perf: 'Performance',
    internal: 'Internal',
};

const KNOWN_KEYS = new Set([
    'type',
    'area',
    'issues',
    'screenshot',
    'highlight',
]);
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DELIMITER = '---';

/** Keeps entries to a sentence or three; essays belong in the blog post. */
const MAX_BODY_LENGTH = 400;

/**
 * A highlight is a headline, not a paragraph — and the limit is the hero
 * card's single-line budget (`wrapText(headline, 60, 1)`). Anything longer is
 * silently ellipsized there, so it is rejected at the source instead.
 */
const MAX_HIGHLIGHT_LENGTH = 60;

/**
 * Splits a note into its frontmatter lines and body.
 *
 * @param {string} content raw file content
 * @returns {{ frontmatterLines: string[], body: string }}
 */
function splitFrontmatter(content) {
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    if (lines[0]?.trim() !== DELIMITER) {
        throw new Error('missing opening `---` frontmatter delimiter');
    }

    const closingIndex = lines.findIndex(
        (line, index) => index > 0 && line.trim() === DELIMITER
    );

    if (closingIndex === -1) {
        throw new Error('missing closing `---` frontmatter delimiter');
    }

    return {
        frontmatterLines: lines.slice(1, closingIndex),
        body: lines.slice(closingIndex + 1).join('\n').trim(),
    };
}

/**
 * Free-form fields, where `#` is ordinary punctuation rather than a comment
 * marker. Everything else in this schema is a closed vocabulary — enum, slug,
 * issue numbers — whose values can never contain one.
 */
const PROSE_KEYS = new Set(['highlight']);

/**
 * Strips a surrounding quote pair. Both ends must carry the SAME quote
 * character: `"Up Next" rail` is prose containing quotes, and stripping its
 * ends independently would silently eat the opening one.
 *
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
    const quote = value[0];
    const isQuoted =
        value.length >= 2 &&
        (quote === "'" || quote === '"') &&
        value.endsWith(quote);

    return (isQuoted ? value.slice(1, -1) : value).trim();
}

/**
 * Parses a single `key: value` frontmatter line.
 *
 * Trailing `# comment` text is stripped from closed-vocabulary fields, whose
 * documented examples carry explanatory comments. Prose fields keep it —
 * `highlight: Sources #N chip` is a headline, not a commented-out value, and
 * stripping there truncated the headline on every announcement surface.
 *
 * @param {string} line
 * @returns {[string, string] | null} key/value pair, or null for blank and
 * whole-line comment lines
 */
function parseFrontmatterLine(line) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
        return null;
    }

    const separatorIndex = trimmed.indexOf(':');

    if (separatorIndex === -1) {
        throw new Error(`frontmatter line is not \`key: value\`: "${trimmed}"`);
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1);
    const value = PROSE_KEYS.has(key)
        ? rawValue
        : rawValue.replace(/\s+#.*$/, '');

    return [key, unquote(value.trim())];
}

/**
 * @param {string} value e.g. `[1187, 1188]` or `1187`
 * @returns {number[]}
 */
function parseIssueList(value) {
    const inner = value.startsWith('[') ? value.replace(/^\[|\]$/g, '') : value;

    return inner
        .split(',')
        .map((entry) => entry.trim().replace(/^#/, ''))
        .filter(Boolean)
        .map((entry) => Number(entry));
}

/**
 * Parses a note file into a structured record. Shape errors throw; semantic
 * errors are reported by validateNote() so a run can list every problem at
 * once instead of failing on the first one.
 *
 * @param {string} content
 * @param {string} sourcePath path used in error messages and PR resolution
 * @returns {{ type: string, area: string, issues: number[], screenshot: string | null, highlight: string | null, body: string, sourcePath: string }}
 */
export function parseNote(content, sourcePath) {
    const { frontmatterLines, body } = splitFrontmatter(content);
    const fields = new Map();

    for (const line of frontmatterLines) {
        const parsed = parseFrontmatterLine(line);

        if (!parsed) {
            continue;
        }

        const [key, value] = parsed;

        if (fields.has(key)) {
            throw new Error(`duplicate frontmatter key: \`${key}\``);
        }

        fields.set(key, value);
    }

    return {
        type: fields.get('type') ?? '',
        area: fields.get('area') ?? '',
        issues: fields.has('issues') ? parseIssueList(fields.get('issues')) : [],
        screenshot: fields.get('screenshot') ?? null,
        highlight: fields.get('highlight') ?? null,
        unknownKeys: [...fields.keys()].filter((key) => !KNOWN_KEYS.has(key)),
        body,
        sourcePath,
    };
}

/**
 * @param {ReturnType<typeof parseNote>} note
 * @returns {string[]} human-readable problems, empty when the note is valid
 */
export function validateNote(note) {
    const errors = [];

    if (!note.type) {
        errors.push('`type` is required');
    } else if (!NOTE_TYPES.includes(note.type)) {
        errors.push(
            `unknown \`type\`: "${note.type}" (expected one of ${NOTE_TYPES.join(', ')})`
        );
    }

    if (!note.area) {
        errors.push('`area` is required (use the conventional-commit scope)');
    } else if (!SLUG_PATTERN.test(note.area)) {
        errors.push(`\`area\` must be a lowercase slug, got "${note.area}"`);
    }

    if (!note.body) {
        errors.push('body is empty — describe the change for a user');
    } else if (note.body.length > MAX_BODY_LENGTH) {
        errors.push(
            `body is ${note.body.length} characters, max ${MAX_BODY_LENGTH} — keep it to a few sentences and put detail in the blog post`
        );
    }

    for (const issue of note.issues) {
        if (!Number.isInteger(issue) || issue <= 0) {
            errors.push(`\`issues\` must be positive integers, got "${issue}"`);
        }
    }

    if (note.screenshot !== null && !SLUG_PATTERN.test(note.screenshot)) {
        errors.push(
            `\`screenshot\` must be a lowercase slug from the screenshot manifest, got "${note.screenshot}"`
        );
    }

    if (note.highlight !== null) {
        if (!note.highlight) {
            errors.push(
                '`highlight` is present but empty — give the feature a short headline or drop the key'
            );
        } else if (note.highlight.length > MAX_HIGHLIGHT_LENGTH) {
            errors.push(
                `\`highlight\` is ${note.highlight.length} characters, max ${MAX_HIGHLIGHT_LENGTH} — it is a headline, the body carries the detail`
            );
        }

        if (note.type === 'internal') {
            errors.push(
                '`highlight` is not allowed on `type: internal` — internal notes never reach announcements'
            );
        }
    }

    for (const key of note.unknownKeys) {
        errors.push(
            `unknown frontmatter key: \`${key}\` (expected ${[...KNOWN_KEYS].join(', ')})`
        );
    }

    return errors;
}

/**
 * Reads and parses every note in a directory, sorted by filename so output
 * ordering is stable across machines.
 *
 * @param {string} directory
 * @returns {{ notes: object[], errors: string[] }}
 */
export function loadNotes(directory) {
    let entries = [];

    try {
        entries = readdirSync(directory);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { notes: [], errors: [] };
        }

        throw error;
    }

    const files = entries
        .filter((name) => name.endsWith('.md') && name !== 'README.md')
        .sort();

    const notes = [];
    const errors = [];

    for (const name of files) {
        const sourcePath = path.join(directory, name);

        try {
            const note = parseNote(readFileSync(sourcePath, 'utf8'), sourcePath);
            const problems = validateNote(note);

            if (problems.length > 0) {
                errors.push(...problems.map((problem) => `${name}: ${problem}`));
                continue;
            }

            notes.push(note);
        } catch (error) {
            errors.push(`${name}: ${error.message}`);
        }
    }

    return { notes, errors };
}

/**
 * Groups notes by type in render order, dropping empty groups.
 *
 * @param {object[]} notes
 * @returns {{ type: string, heading: string, notes: object[] }[]}
 */
export function groupNotes(notes) {
    return NOTE_TYPES.map((type) => ({
        type,
        heading: TYPE_HEADINGS[type],
        notes: notes.filter((note) => note.type === type),
    })).filter((group) => group.notes.length > 0);
}
