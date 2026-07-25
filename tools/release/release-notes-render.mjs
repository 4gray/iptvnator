/**
 * Renderers turning grouped `.changes/*.md` notes into the three release
 * surfaces: the GitHub release body, the CHANGELOG.md section, and the
 * website blog scaffold.
 */

import { groupNotes, REPO_URL } from './release-notes.mjs';

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

/**
 * @param {string} isoDate `YYYY-MM-DD`
 * @returns {string} e.g. `August 1, 2026`
 */
export function formatLongDate(isoDate) {
    const [year, month, day] = isoDate.split('-').map(Number);

    return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/**
 * Deliberately minor-scoped: the website publishes one release post per minor
 * version (`v0-18` … `v0-22`), and its screenshot assets live under the same
 * directory. A patch release therefore reuses its minor's post rather than
 * starting a new one.
 *
 * @param {string} version
 * @returns {string} e.g. `v0-24` for both `0.24.0` and `0.24.1`
 */
export function releaseSlug(version) {
    const [major, minor] = version.split('.');

    return `v${major}-${minor}`;
}

/** Collapses a note body to a single line for list entries. */
function oneLine(body) {
    return body.replace(/\s+/g, ' ').trim();
}

/** Trims to a word boundary; used for image alt text, never for prose. */
function truncate(text, max) {
    if (text.length <= max) {
        return text;
    }

    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');

    return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * MDX parses `<` and `{` as markup. Note bodies are plain prose written by
 * humans and agents, so escape them rather than letting a stray character
 * break the website build. The closing counterparts are escaped too, so a
 * body like `<live>` renders as written instead of half-escaped.
 */
function escapeMdx(text) {
    return text
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\{/g, '&#123;')
        .replace(/\}/g, '&#125;');
}

/**
 * @param {object} note
 * @param {Map<string, { pr?: number, commit?: string }>} links
 * @returns {string} trailing `([#123](url), closes [#45](url))` or ''
 */
function formatReferences(note, links) {
    const parts = [];
    const link = links.get(note.sourcePath);

    if (link?.pr) {
        parts.push(`[#${link.pr}](${REPO_URL}/pull/${link.pr})`);
    } else if (link?.commit) {
        parts.push(
            `[${link.commit.slice(0, 7)}](${REPO_URL}/commit/${link.commit})`
        );
    }

    for (const issue of note.issues) {
        parts.push(`closes [#${issue}](${REPO_URL}/issues/${issue})`);
    }

    return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function formatEntry(note, links) {
    return `- **${note.area}** — ${oneLine(note.body)}${formatReferences(note, links)}`;
}

/**
 * GitHub release body. `internal` notes are omitted: the release page is read
 * by users, and GitHub still appends its own full commit list below.
 *
 * @param {object[]} notes
 * @param {{ links?: Map<string, object> }} [options]
 * @returns {string}
 */
export function renderGithubBody(notes, { links = new Map() } = {}) {
    const sections = groupNotes(notes)
        .filter((group) => group.type !== 'internal')
        .map((group) => {
            const entries = group.notes
                .map((note) => formatEntry(note, links))
                .join('\n');

            return `## ${group.heading}\n\n${entries}`;
        });

    return sections.join('\n\n');
}

/**
 * CHANGELOG.md section. Unlike the release body this keeps `internal` notes,
 * collapsed, so the file stays a complete record.
 *
 * @param {object[]} notes
 * @param {{ version: string, date: string, previousVersion?: string | null, links?: Map<string, object> }} options
 * @returns {string}
 */
export function renderChangelogSection(
    notes,
    { version, date, previousVersion = null, links = new Map() }
) {
    const heading = previousVersion
        ? `# [${version}](${REPO_URL}/compare/v${previousVersion}...v${version}) (${date})`
        : `# ${version} (${date})`;

    const blocks = [heading];

    for (const group of groupNotes(notes)) {
        const entries = group.notes
            .map((note) => formatEntry(note, links))
            .join('\n');

        if (group.type === 'internal') {
            blocks.push(
                `<details>\n<summary>Internal changes</summary>\n\n${entries}\n\n</details>`
            );
            continue;
        }

        blocks.push(`### ${group.heading}\n\n${entries}`);
    }

    return `${blocks.join('\n\n')}\n`;
}

/**
 * Blog entries carrying a `screenshot:` slug become their own subsection with
 * an image slider; the rest stay bullets.
 */
function renderBlogGroup(group, { slug, links }) {
    const bullets = group.notes.filter((note) => !note.screenshot);
    const featured = group.notes.filter((note) => note.screenshot);
    const blocks = [`## ${group.heading}`];

    if (bullets.length > 0) {
        blocks.push(
            bullets
                .map(
                    (note) =>
                        `- **${note.area}** — ${escapeMdx(oneLine(note.body))}${formatReferences(note, links)}`
                )
                .join('\n')
        );
    }

    for (const note of featured) {
        // The heading is editorial work — a note body makes a terrible one.
        // Leave a visible TODO instead of pretending otherwise; the whole
        // scaffold ships as `draft: true` anyway.
        // Embedded in a single-quoted JS string inside MDX. Backslashes must
        // be escaped before apostrophes, or a body ending in `\` produces an
        // unterminated string and breaks the website build.
        const alt = truncate(oneLine(note.body), 120)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'");
        const images = ['dark', 'light']
            .map(
                (theme) =>
                    `        {\n            src: '/iptvnator/blog/${slug}/screenshots/${note.screenshot}-${theme}.png',\n            alt: '${alt}',\n        },`
            )
            .join('\n');

        blocks.push(`### TODO headline (${note.area})`);
        blocks.push(
            `${escapeMdx(oneLine(note.body))}${formatReferences(note, links)}`
        );
        blocks.push(`<BlogImageSlider\n    images={[\n${images}\n    ]}\n/>`);
    }

    return blocks.join('\n\n');
}

/**
 * Scaffold for `apps/website/src/content/blog/v0-24-release-notes.mdx`.
 * Deliberately incomplete: `draft: true`, TODO markers for the narrative and
 * description. The prose is editorial work, only the inventory is mechanical.
 *
 * @param {object[]} notes
 * @param {{ version: string, date: string, links?: Map<string, object> }} options
 * @returns {string}
 */
export function renderBlogScaffold(notes, { version, date, links = new Map() }) {
    const slug = releaseSlug(version);
    const shortVersion = slug.replace('-', '.');
    const sections = groupNotes(notes)
        .filter((group) => group.type !== 'internal')
        .map((group) => renderBlogGroup(group, { slug, links }));

    const frontmatter = [
        '---',
        `title: ${shortVersion} - Release Notes`,
        'description: TODO — one sentence naming the two or three headline changes.',
        'featured: true',
        `pubDate: ${date}`,
        'author: 4gray',
        `heroImage: /iptvnator/blog/${slug}/hero.jpg`,
        'tags:',
        '    - release',
        '    - release-notes',
        `    - ${shortVersion}`,
        'draft: true',
        '---',
    ].join('\n');

    const imports = [
        "import BlogImageSlider from '../../components/blog/BlogImageSlider.astro';",
        "import ReleaseMeta from '../../components/blog/ReleaseMeta.astro';",
    ].join('\n');

    const meta = [
        '<ReleaseMeta',
        `    version="v${version}"`,
        `    releaseDate="${formatLongDate(date)}"`,
        "    channels={['Desktop', 'PWA']}",
        '/>',
    ].join('\n');

    return [
        frontmatter,
        imports,
        '{/* TODO: narrative intro — what this release is about, not what it contains. */}',
        meta,
        ...sections,
        '',
    ].join('\n\n');
}
