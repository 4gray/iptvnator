/**
 * Website blog scaffold for
 * `apps/website/src/content/blog/<vX-Y>-release-notes.mdx`.
 *
 * The scaffold ships in the shape the published posts end up in, so a release
 * starts from the form instead of from an inventory the editor has to
 * rebuild (the v0.23 post went out as the raw type-grouped list and had to be
 * restructured afterwards):
 *
 *   intro → ReleaseMeta → "What changed" table (one row per `highlight:`)
 *   → one `##` section per highlight, first → breaking changes → themed
 *   "improved" sections for the remaining features → Performance → every
 *   remaining fix under a Spoiler, grouped by theme → Before-updating alert
 *   → Thanks → Download cards.
 *
 * Deliberately incomplete: `draft: true`, TODO markers wherever a human has
 * to write. The prose is editorial work, only the inventory is mechanical —
 * including which fixes deserve promotion out of the spoiler.
 */

import { NOTE_TYPES, REPO_URL } from './release-notes.mjs';
import {
    escapeMdx,
    formatLongDate,
    formatReferences,
    oneLine,
    releaseSlug,
    truncate,
} from './release-notes-render.mjs';

/**
 * Reader-facing sections, in post order. `area` is the conventional-commit
 * scope of the PR, which says nothing to a user ("matching",
 * "window-controls", "electron-backend"), so notes are folded into these
 * themes instead. An area not listed here lands in {@link BLOG_FALLBACK_THEME}
 * rather than failing — the editor merges it where it belongs.
 */
export const BLOG_THEMES = [
    { heading: 'Downloads and recordings', areas: ['downloads', 'recordings'] },
    {
        heading: 'Playback',
        areas: ['playback', 'player', 'embedded-mpv', 'mpv', 'vlc', 'subtitles'],
    },
    {
        heading: 'Movies, series and the dashboard',
        areas: [
            'portals',
            'portal',
            'vod',
            'series',
            'tmdb',
            'dashboard',
            'matching',
            'favorites',
            'recent',
        ],
    },
    { heading: 'Xtream', areas: ['xtream'] },
    { heading: 'Stalker portals', areas: ['stalker'] },
    {
        heading: 'Live TV, EPG and M3U',
        areas: ['m3u', 'epg', 'live', 'radio', 'catchup', 'remote-control'],
    },
    { heading: 'Search', areas: ['search'] },
    {
        heading: 'Settings, import and the desktop app',
        areas: [
            'settings',
            'playlist',
            'playlists',
            'import',
            'backup',
            'ui',
            'components',
            'workspace',
            'i18n',
            'electron',
            'electron-backend',
            'window-controls',
            'updater',
            'deps',
            'packaging',
            'database',
        ],
    },
    { heading: 'Self-hosted web version', areas: ['pwa', 'web-backend', 'docker'] },
];

export const BLOG_FALLBACK_THEME = 'Other changes';

const STATUS_PILL_BY_TYPE = {
    breaking: 'breaking',
    feature: 'new',
    fix: 'fixed',
    perf: 'improved',
};

const COMPONENT_IMPORTS = {
    Alert: "import Alert from '../../components/blog/Alert.astro';",
    BlogImageSlider:
        "import BlogImageSlider from '../../components/blog/BlogImageSlider.astro';",
    ChangeTable:
        "import ChangeTable from '../../components/blog/ChangeTable.astro';",
    LinkCards: "import LinkCards from '../../components/blog/LinkCards.astro';",
    ReleaseMeta:
        "import ReleaseMeta from '../../components/blog/ReleaseMeta.astro';",
    Spoiler: "import Spoiler from '../../components/blog/Spoiler.astro';",
    StatusPill:
        "import StatusPill from '../../components/blog/StatusPill.astro';",
};

const SCREENSHOT_ALERT = [
    '<Alert type="info" title="About the screenshots">',
    "The screenshots and posters shown here come from the project's own mock servers with fictional catalog data. IPTVnator is a pure media player — it does not provide, host, bundle, or distribute any streams, playlists, or media content. You bring your own sources; the app just plays them.",
    '</Alert>',
].join('\n');

/**
 * Embedded in a single-quoted JS string inside MDX. Backslashes must be
 * escaped before apostrophes, or a body ending in `\` produces an unterminated
 * string and breaks the website build.
 */
function jsString(text) {
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function themeHeadingOf(area) {
    return (
        BLOG_THEMES.find((theme) => theme.areas.includes(area))?.heading ??
        BLOG_FALLBACK_THEME
    );
}

/**
 * @returns {{ heading: string, notes: object[] }[]} non-empty theme groups in
 * {@link BLOG_THEMES} order, the fallback theme last
 */
export function groupNotesByTheme(notes) {
    const headings = [
        ...BLOG_THEMES.map((theme) => theme.heading),
        BLOG_FALLBACK_THEME,
    ];

    return headings
        .map((heading) => ({
            heading,
            notes: notes.filter((note) => themeHeadingOf(note.area) === heading),
        }))
        .filter((group) => group.notes.length > 0);
}

/** A note that carries a headline or a screenshot gets its own section. */
function isFeatured(note) {
    return Boolean(note.highlight || note.screenshot);
}

function statusPill(type) {
    return `<StatusPill type="${STATUS_PILL_BY_TYPE[type]}" />`;
}

function bullet(note, links) {
    return `- ${escapeMdx(oneLine(note.body))}${formatReferences(note, links)}`;
}

function renderSlider(note, slug) {
    const alt = jsString(truncate(oneLine(note.body), 120));
    const images = ['dark', 'light']
        .map(
            (theme) =>
                `        {\n            src: '/iptvnator/blog/${slug}/screenshots/${note.screenshot}-${theme}.png',\n            alt: '${alt}',\n        },`
        )
        .join('\n');

    return `<BlogImageSlider\n    images={[\n${images}\n    ]}\n/>`;
}

/**
 * A `highlight:` headline is the editorial headline; a screenshot note
 * without one still deserves its own section, but the heading is editorial
 * work a note body cannot stand in for — leave a visible TODO instead of
 * pretending otherwise.
 */
function renderFeaturedSection(note, { slug, links }) {
    const blocks = [
        note.highlight
            ? `## ${escapeMdx(note.highlight)}`
            : `## TODO headline (${note.area})`,
        statusPill(note.type),
        `${escapeMdx(oneLine(note.body))}${formatReferences(note, links)}`,
    ];

    if (note.screenshot) {
        blocks.push(renderSlider(note, slug));
    }

    return blocks.join('\n\n');
}

function renderChangeTable(highlights) {
    const rows = highlights
        .map((note) =>
            [
                '        {',
                `            area: '${jsString(themeHeadingOf(note.area))}',`,
                `            change: '${jsString(oneLine(note.body))}',`,
                "            impact: 'TODO — one short phrase',",
                '        },',
            ].join('\n')
        )
        .join('\n');

    return `## What changed\n\n<ChangeTable\n    rows={[\n${rows}\n    ]}\n/>`;
}

/**
 * @param {string} pill a `StatusPill` type — the published posts label every
 * bullet section `improved` (its items are not the release's headline
 * features, those have sections of their own) except breaking changes
 */
function renderBulletSection(heading, pill, notes, links) {
    return [
        `## ${heading}`,
        `<StatusPill type="${pill}" />`,
        notes.map((note) => bullet(note, links)).join('\n'),
    ].join('\n\n');
}

function renderThemedSections(notes, links) {
    return groupNotesByTheme(notes).map((group) =>
        renderBulletSection(group.heading, 'improved', group.notes, links)
    );
}

/**
 * Fixes without a headline collapse under a Spoiler, grouped by theme. That
 * is a default, not a verdict: the editor promotes the fixes worth a
 * paragraph into the open sections above.
 */
function renderFixesSpoiler(fixes, links) {
    const count = fixes.length;
    const groups = groupNotesByTheme(fixes)
        .map((group) =>
            [
                `**${group.heading}**`,
                group.notes.map((note) => bullet(note, links)).join('\n'),
            ].join('\n\n')
        )
        .join('\n\n');

    return [
        '## Everything else',
        `That is the part worth reading in one sitting. The remaining ${count} ${count === 1 ? 'fix is' : 'fixes are'} below, one line each. {/* TODO: promote the fixes users will notice into the sections above. */}`,
        `<Spoiler title="Show the remaining fixes">\n\n${groups}\n\n</Spoiler>`,
    ].join('\n\n');
}

function renderLinkCards(version, previousVersion) {
    const tag = `v${version}`;
    const cards = [
        {
            label: `Download ${tag}`,
            href: `${REPO_URL}/releases/tag/${tag}`,
            hint: 'Official binaries for macOS, Windows and Linux.',
            icon: 'download',
        },
        {
            label: 'Full release notes',
            href: `${REPO_URL}/releases/tag/${tag}`,
            hint: 'Every entry in full, on GitHub.',
            icon: 'github',
        },
    ];

    if (previousVersion) {
        cards.push({
            label: 'Full Changelog',
            href: `${REPO_URL}/compare/v${previousVersion}...${tag}`,
            hint: `Every commit between v${previousVersion} and ${tag}.`,
            icon: 'github',
        });
    }

    cards.push({
        label: 'All Releases',
        href: `${REPO_URL}/releases`,
        hint: 'Browse every IPTVnator release.',
        icon: 'github',
    });

    const links = cards
        .map((card) =>
            [
                '        {',
                `            label: '${jsString(card.label)}',`,
                `            href: '${card.href}',`,
                `            hint: '${jsString(card.hint)}',`,
                `            icon: '${card.icon}',`,
                '        },',
            ].join('\n')
        )
        .join('\n');

    return `<LinkCards\n    links={[\n${links}\n    ]}\n/>`;
}

function renderClosing(version, previousVersion) {
    return [
        '<Alert type="warning" title="Before updating">\nPlease back up your playlists, credentials, URLs, and other important data before installing a new release. {/* TODO: say whether this release changes the database schema or carries breaking changes. */}\n</Alert>',
        '## Thanks',
        '{/* TODO: thank the testers, reporters, translators and sponsors behind this release. */}',
        '## Download',
        renderLinkCards(version, previousVersion),
    ];
}

function renderFrontmatter(shortVersion, slug, date) {
    return [
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
}

/**
 * @param {object[]} notes
 * @param {{ version: string, date: string, previousVersion?: string | null, links?: Map<string, object> }} options
 * @returns {string}
 */
export function renderBlogScaffold(
    notes,
    { version, date, previousVersion = null, links = new Map() }
) {
    const slug = releaseSlug(version);
    const shortVersion = slug.replace('-', '.');
    const publicNotes = notes.filter((note) => note.type !== 'internal');
    const byType = (type) => publicNotes.filter((note) => note.type === type);

    const featured = NOTE_TYPES.flatMap((type) => byType(type).filter(isFeatured));
    const highlights = featured.filter((note) => note.highlight);
    const rest = (type) => byType(type).filter((note) => !isFeatured(note));
    const breaking = rest('breaking');
    const features = rest('feature');
    const fixes = rest('fix');
    const perf = rest('perf');
    const hasScreenshot = featured.some((note) => note.screenshot);

    const used = new Set(['Alert', 'LinkCards', 'ReleaseMeta']);
    if (publicNotes.length > 0) used.add('StatusPill');
    if (highlights.length > 0) used.add('ChangeTable');
    if (hasScreenshot) used.add('BlogImageSlider');
    if (fixes.length > 0) used.add('Spoiler');

    const imports = Object.keys(COMPONENT_IMPORTS)
        .filter((name) => used.has(name))
        .map((name) => COMPONENT_IMPORTS[name])
        .join('\n');

    const meta = [
        '<ReleaseMeta',
        `    version="v${version}"`,
        `    releaseDate="${formatLongDate(date)}"`,
        "    channels={['Desktop', 'PWA']}",
        '/>',
    ].join('\n');

    const body = [
        renderFrontmatter(shortVersion, slug, date),
        imports,
        '{/* TODO: narrative intro — what this release is about, not what it contains. */}',
        meta,
    ];

    if (highlights.length > 0) body.push(renderChangeTable(highlights));
    if (hasScreenshot) body.push(SCREENSHOT_ALERT);
    body.push(...featured.map((note) => renderFeaturedSection(note, { slug, links })));
    if (breaking.length > 0) {
        body.push(renderBulletSection('Breaking changes', 'breaking', breaking, links));
    }
    body.push(...renderThemedSections(features, links));
    if (perf.length > 0) {
        body.push(renderBulletSection('Performance', 'improved', perf, links));
    }
    if (fixes.length > 0) body.push(renderFixesSpoiler(fixes, links));
    body.push(...renderClosing(version, previousVersion), '');

    return body.join('\n\n');
}
