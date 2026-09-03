#!/usr/bin/env node
/**
 * Composes release surfaces from the notes accumulated in `.changes/`.
 *
 *   node tools/release/build-release-notes.mjs --validate
 *   node tools/release/build-release-notes.mjs --version 0.24.0 --format github
 *   node tools/release/build-release-notes.mjs --version 0.24.0 --format changelog
 *   node tools/release/build-release-notes.mjs --version 0.24.0 --format blog
 *   node tools/release/build-release-notes.mjs --version 0.24.0 --format telegram
 *   node tools/release/build-release-notes.mjs --version 0.24.0 --format reddit
 *   node tools/release/build-release-notes.mjs --version 0.24.0 --consume
 *
 * Every mode except `--consume` is a safe dry run: nothing is deleted unless
 * `--consume` is passed explicitly.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
    renderRedditPost,
    renderTelegramPost,
} from './release-announcements.mjs';
import { loadNotes } from './release-notes.mjs';
import { manifestSlugs } from './screenshot-guards.mjs';
import { renderBlogScaffold } from './release-notes-blog.mjs';
import {
    releaseSlug,
    renderChangelogSection,
    renderGithubBody,
    upsertChangelogSection,
} from './release-notes-render.mjs';

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const CHANGELOG_PATH = path.join(workspaceRoot, 'CHANGELOG.md');
const BLOG_DIR = path.join(workspaceRoot, 'apps/website/src/content/blog');

/** Generated sections are inserted directly below this marker. */
const CHANGELOG_MARKER = '<!-- next-release -->';

const FORMATS = new Set(['github', 'changelog', 'blog', 'telegram', 'reddit']);

function parseArgs(argv) {
    const options = {
        format: null,
        version: null,
        previous: null,
        date: new Date().toISOString().slice(0, 10),
        dir: '.changes',
        validate: false,
        consume: false,
        force: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const takeValue = () => {
            const value = argv[index + 1];

            if (value === undefined || value.startsWith('--')) {
                throw new Error(`${arg} requires a value`);
            }

            index += 1;
            return value;
        };

        switch (arg) {
            case '--format':
                options.format = takeValue();
                break;
            case '--version':
                options.version = takeValue();
                break;
            case '--previous':
                options.previous = takeValue();
                break;
            case '--date':
                options.date = takeValue();
                break;
            case '--dir':
                options.dir = takeValue();
                break;
            case '--validate':
                options.validate = true;
                break;
            case '--consume':
                options.consume = true;
                break;
            case '--force':
                options.force = true;
                break;
            // npm needs `--` to forward arguments past the script name; pnpm
            // hands it to the script verbatim. Ignore it so the habitual
            // `pnpm run release:notes:github -- --version 0.24.0` works
            // instead of dying on its own separator. There are no positional
            // arguments for it to delimit.
            case '--':
                break;
            default:
                throw new Error(`unknown argument: ${arg}`);
        }
    }

    return options;
}

function git(args) {
    return execFileSync('git', args, {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
}

/**
 * Resolves each note to the commit that added it, and to a PR number when the
 * commit subject carries one. Authors never write a PR number themselves —
 * they cannot know it while the branch is still local.
 *
 * @param {object[]} notes
 * @returns {Map<string, { commit?: string, pr?: number }>}
 */
function resolveLinks(notes) {
    const links = new Map();

    for (const note of notes) {
        let output = '';

        try {
            output = git([
                'log',
                '--diff-filter=A',
                '--format=%H%x00%s',
                '-1',
                '--',
                note.sourcePath,
            ]);
        } catch {
            // Not a git checkout, or the note is not committed yet. Entries
            // simply render without a reference link.
        }

        if (!output) {
            continue;
        }

        const [commit, subject = ''] = output.split('\0');
        const prMatch = subject.match(/\(#(\d+)\)\s*$/);

        links.set(note.sourcePath, {
            commit,
            pr: prMatch ? Number(prMatch[1]) : undefined,
        });
    }

    return links;
}

/** Latest `v*` tag, used for the CHANGELOG compare link. */
function detectPreviousVersion() {
    try {
        return git(['describe', '--tags', '--abbrev=0', '--match=v*']).replace(
            /^v/,
            ''
        );
    } catch {
        return null;
    }
}

/**
 * The release version is the one in the root package.json — bumping it is the
 * deliberate act that starts a release. `--version` stays available as an
 * override (dry runs, previewing a version before the bump), but the default
 * keeps a single source of truth and lets the package scripts run bare.
 */
function resolveVersion(options) {
    let version = options.version;

    if (!version) {
        version = JSON.parse(
            readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')
        ).version;

        // stderr, so `--format github` keeps a clean pipeable stdout.
        console.error(`Using version ${version} from package.json.`);
    }

    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(
            `version must be a bare semver like 0.24.0, got "${version}"`
        );
    }

    return version;
}

function writeChangelog(section, version) {
    const { content, replaced } = upsertChangelogSection(
        readFileSync(CHANGELOG_PATH, 'utf8'),
        section,
        version,
        CHANGELOG_MARKER
    );

    if (replaced) {
        console.error(`Replacing existing CHANGELOG.md section for ${version}.`);
    }

    writeFileSync(CHANGELOG_PATH, content, 'utf8');

    return CHANGELOG_PATH;
}

function writeBlogScaffold(content, version, force) {
    const target = path.join(
        BLOG_DIR,
        `${releaseSlug(version)}-release-notes.mdx`
    );

    if (existsSync(target) && !force) {
        throw new Error(
            [
                `${path.relative(workspaceRoot, target)} already exists.`,
                'The website publishes one post per minor version, so a patch',
                'release edits the existing post instead of creating a new one.',
                'Pass --force only to regenerate it from scratch.',
            ].join(' ')
        );
    }

    writeFileSync(target, content, 'utf8');

    return target;
}

/**
 * An internal-only release has nothing to announce publicly. That is a legal
 * release shape, so it prints an explanation on stderr and leaves stdout
 * empty — matching `extract-changelog-section.mjs --public`, which allows an
 * empty public body for exactly the same case — rather than failing.
 *
 * @param {string | null} post
 * @param {string} label
 */
function writeAnnouncement(post, label) {
    if (post === null) {
        console.error(
            `Internal-only release: no public ${label} announcement to render.`
        );

        return;
    }

    process.stdout.write(post.endsWith('\n') ? post : `${post}\n`);
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const notesDir = path.resolve(workspaceRoot, options.dir);
    const { notes, errors } = loadNotes(notesDir);

    // `screenshot:` slugs must exist in the capture manifest, otherwise the
    // blog scaffold would reference images the capture run never produces.
    const slugs = manifestSlugs(
        JSON.parse(
            readFileSync(
                path.join(workspaceRoot, 'tools/release/screenshots.manifest.json'),
                'utf8'
            )
        )
    );

    for (const note of notes) {
        if (note.screenshot && !slugs.has(note.screenshot)) {
            errors.push(
                `${path.basename(note.sourcePath)}: \`screenshot: ${note.screenshot}\` is not a slug in tools/release/screenshots.manifest.json`
            );
        }
    }

    if (errors.length > 0) {
        console.error('Invalid release notes:\n');
        for (const error of errors) {
            console.error(`  ${error}`);
        }
        console.error(
            '\nSee .changes/README.md for the expected format.'
        );
        process.exit(1);
    }

    if (options.validate) {
        console.log(`${notes.length} release note(s) valid.`);
    }

    if (options.format) {
        if (!FORMATS.has(options.format)) {
            throw new Error(
                `unknown --format "${options.format}" (expected ${[...FORMATS].join(', ')})`
            );
        }

        const version = resolveVersion(options);
        const links = resolveLinks(notes);

        if (notes.length === 0) {
            throw new Error(
                `no notes found in ${path.relative(workspaceRoot, notesDir)}/ — nothing to render`
            );
        }

        if (options.format === 'github') {
            process.stdout.write(`${renderGithubBody(notes, { links })}\n`);
        }

        // Announcements are dry runs to stdout, like `github`. They must be
        // rendered before `--consume`: the CHANGELOG keeps the entries, but
        // the `highlight:` metadata lives only in the note files.
        if (options.format === 'telegram') {
            writeAnnouncement(renderTelegramPost(notes, { version }), 'Telegram');
        }

        if (options.format === 'reddit') {
            writeAnnouncement(renderRedditPost(notes, { version }), 'Reddit');
        }

        if (options.format === 'changelog') {
            const section = renderChangelogSection(notes, {
                version,
                date: options.date,
                previousVersion: options.previous ?? detectPreviousVersion(),
                links,
            });
            const target = writeChangelog(section, version);
            console.log(`Updated ${path.relative(workspaceRoot, target)}`);
        }

        if (options.format === 'blog') {
            const content = renderBlogScaffold(notes, {
                version,
                date: options.date,
                previousVersion: options.previous ?? detectPreviousVersion(),
                links,
            });
            const target = writeBlogScaffold(content, version, options.force);
            console.log(`Wrote ${path.relative(workspaceRoot, target)}`);
        }
    }

    if (options.consume) {
        for (const note of notes) {
            rmSync(note.sourcePath);
        }

        console.log(`Removed ${notes.length} consumed note(s).`);
    }

    if (!options.format && !options.validate && !options.consume) {
        throw new Error(
            'nothing to do — pass --validate, --format <github|changelog|blog>, or --consume'
        );
    }
}

try {
    main();
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
