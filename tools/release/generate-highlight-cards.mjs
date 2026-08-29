#!/usr/bin/env node
/**
 * Renders release highlight cards from `highlight:` notes: one 1200×630
 * card per highlight (branded background, headline, body, framed screenshot
 * strip when the note names one) plus a release hero card.
 *
 *   node tools/release/generate-highlight-cards.mjs --dry-run
 *   node tools/release/generate-highlight-cards.mjs --generate
 *   node tools/release/generate-highlight-cards.mjs --generate --theme light
 *
 * Must run BEFORE `--consume` (the highlight metadata lives only in the note
 * files) and after `release:screenshots` (screenshot strips are read from the
 * published blog directory). Output goes to dist/, outside version control —
 * committing a card into the website tree is a deliberate manual act.
 */

import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import {
    buildFeatureCardSvg,
    buildHeroCardSvg,
    buildShotMaskSvg,
    CARD_HEIGHT,
    isOwnedCardFile,
    SHOT_LEFT,
    SHOT_TOP,
    SHOT_WIDTH,
    planHighlightCards,
} from './highlight-cards.mjs';
import { loadNotes } from './release-notes.mjs';
import { releaseSlug } from './release-notes-render.mjs';

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../..'
);
const CLI_USAGE =
    'Usage: generate-highlight-cards.mjs (--dry-run | --generate) [--theme dark|light] [--version <semver>] [--dir <notes-dir>] [--out <dir>]';

export function parseCardArguments(args) {
    const options = {
        mode: null,
        theme: 'dark',
        version: null,
        dir: '.changes',
        out: null,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const takeValue = () => {
            const value = args[index + 1];

            if (!value || value.startsWith('--')) {
                return null;
            }

            index += 1;

            return value;
        };

        if (arg === '--dry-run' || arg === '--generate') {
            if (options.mode) {
                return null;
            }

            options.mode = arg.slice(2);
        } else if (arg === '--theme') {
            const value = takeValue();

            if (value !== 'dark' && value !== 'light') {
                return null;
            }

            options.theme = value;
        } else if (arg === '--version') {
            const value = takeValue();

            if (!value || !/^\d+\.\d+\.\d+$/.test(value)) {
                return null;
            }

            options.version = value;
        } else if (arg === '--dir' || arg === '--out') {
            const value = takeValue();

            if (!value) {
                return null;
            }

            options[arg.slice(2)] = value;
        } else if (arg !== '--') {
            return null;
        }
    }

    return options.mode ? options : null;
}

/**
 * Composites the bottom screenshot strip: resize to the strip width, crop to
 * the visible height, round the corners via a dest-in mask.
 *
 * @param {string} screenshotPath
 * @returns {Promise<{ input: Buffer, left: number, top: number }>}
 */
async function prepareShotOverlay(screenshotPath) {
    const stripHeight = CARD_HEIGHT - SHOT_TOP;
    const resized = sharp(screenshotPath).resize({ width: SHOT_WIDTH });
    const metadata = await resized.png().toBuffer({ resolveWithObject: true });
    const visibleHeight = Math.min(stripHeight, metadata.info.height);
    const cropped = await sharp(metadata.data)
        .extract({
            left: 0,
            top: 0,
            width: SHOT_WIDTH,
            height: visibleHeight,
        })
        .composite([
            {
                input: Buffer.from(buildShotMaskSvg(SHOT_WIDTH, visibleHeight)),
                blend: 'dest-in',
            },
        ])
        .png()
        .toBuffer();

    return { input: cropped, left: SHOT_LEFT, top: SHOT_TOP };
}

/**
 * Repo-relative when the path is inside the workspace, absolute otherwise:
 * `--out /tmp/cards` printed as a stack of `../../..` segments is worse than
 * no shortening at all.
 *
 * @param {string} target
 * @returns {string}
 */
function displayPath(target) {
    const relative = path.relative(workspaceRoot, target);

    return relative.startsWith('..') ? target : relative;
}

/**
 * Removes the cards a previous run of THIS generator left in `outputDir`, so a
 * renamed, dropped, or newly-internal highlight cannot leave a stale image
 * sitting there waiting to be published. Only files matching what this tool
 * writes are touched; anything else in the directory is left alone.
 *
 * @param {string} outputDir
 * @returns {string[]} removed filenames
 */
export function removeStaleCards(outputDir) {
    if (!existsSync(outputDir)) {
        return [];
    }

    const stale = readdirSync(outputDir).filter(isOwnedCardFile);

    for (const entry of stale) {
        rmSync(path.join(outputDir, entry));
    }

    return stale;
}

/**
 * @param {{ feature: object[], hero: object }} plan
 * @param {string} version
 * @param {string} outputDir
 * @returns {Promise<string[]>} written file paths
 */
export async function renderCards(plan, version, outputDir) {
    mkdirSync(outputDir, { recursive: true });
    removeStaleCards(outputDir);

    const written = [];

    for (const job of plan.feature) {
        const base = sharp(Buffer.from(buildFeatureCardSvg(job, version)));
        const composites = job.screenshotPath
            ? [await prepareShotOverlay(job.screenshotPath)]
            : [];
        const target = path.join(outputDir, job.fileName);

        await base.composite(composites).png().toFile(target);
        written.push(target);
    }

    const heroSvg = Buffer.from(buildHeroCardSvg(plan.hero));
    const heroPng = path.join(outputDir, plan.hero.fileName);
    const heroJpg = path.join(outputDir, 'hero.jpg');

    await sharp(heroSvg).png().toFile(heroPng);
    // The blog scaffold's frontmatter references `hero.jpg`.
    await sharp(heroSvg).flatten().jpeg({ quality: 92 }).toFile(heroJpg);
    written.push(heroPng, heroJpg);

    return written;
}

async function main() {
    const options = parseCardArguments(process.argv.slice(2));

    if (options === null) {
        console.error(CLI_USAGE);
        process.exit(2);
    }

    if (options.version === null) {
        options.version = JSON.parse(
            readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8')
        ).version;
        console.error(`Using version ${options.version} from package.json.`);
    }

    const notesDir = path.resolve(workspaceRoot, options.dir);
    const { notes, errors } = loadNotes(notesDir);

    if (errors.length > 0) {
        console.error('Invalid release notes:\n');
        for (const error of errors) {
            console.error(`  ${error}`);
        }
        process.exit(1);
    }

    // An empty directory is not an internal-only release: it is almost always
    // this step running AFTER `--consume` deleted the notes, which is the one
    // ordering mistake the whole pipeline warns about. Reporting it as
    // "internal-only" would hide the mistake and quietly ship no cards at all.
    if (notes.length === 0) {
        console.error(
            [
                `No notes found in ${displayPath(notesDir)}/.`,
                'Cards are built from `highlight:`, which exists only in the note',
                'files — if `build-release-notes.mjs --consume` already ran, that',
                'metadata is gone. Render cards before consuming.',
            ].join(' ')
        );
        process.exit(1);
    }

    const slug = releaseSlug(options.version);
    const screenshotsDir = path.join(
        workspaceRoot,
        'apps/website/public/blog',
        slug,
        'screenshots'
    );
    const plan = planHighlightCards(notes, {
        version: options.version,
        releaseSlug: slug,
        screenshotsDir,
        theme: options.theme,
    });
    // Keyed by the exact version, not the minor slug: 0.24.0 and 0.24.1 share
    // a blog post but not a card set, and mixing them in one directory invites
    // publishing the previous patch's card.
    const outputDir = path.resolve(
        workspaceRoot,
        options.out ??
            path.join('dist/release-highlight-cards', `v${options.version}`)
    );

    // Neither shape below is an error: an internal-only release is legal, and
    // a release nobody marked a highlight on still deserves its hero card.
    // Failing here would break the documented release sequence.
    if (plan.publicNoteCount === 0) {
        console.error(
            'Internal-only release: no public change to put on a card.'
        );

        // A release that turned internal-only after cards were already made
        // for this exact version must not leave them behind. `--dry-run`
        // deletes nothing.
        if (options.mode === 'generate') {
            const removed = removeStaleCards(outputDir);

            if (removed.length > 0) {
                console.log(
                    `Removed ${removed.length} card(s) left by an earlier run of v${options.version}.`
                );
            }
        }

        return;
    }

    if (plan.feature.length === 0) {
        console.error(
            'No `highlight:` notes found — rendering the hero card only. Mark the headline changes in .changes/ to get feature cards.'
        );
    }

    const missingShots = plan.feature.filter(
        (job) => job.screenshotPath && !existsSync(job.screenshotPath)
    );

    if (missingShots.length > 0) {
        console.error('Missing screenshot(s) for highlight card(s):\n');
        for (const job of missingShots) {
            console.error(
                `  ${displayPath(job.screenshotPath)}`
            );
        }
        console.error('\nRun `pnpm run release:screenshots` first.');
        process.exit(1);
    }

    console.log(`${plan.feature.length} highlight card(s) + hero for v${options.version}:`);
    for (const job of plan.feature) {
        const shot = job.screenshotPath
            ? displayPath(job.screenshotPath)
            : 'no screenshot (typographic card)';

        console.log(`  ${job.fileName} — "${job.headline}" (${shot})`);
    }

    if (options.mode === 'dry-run') {
        console.log(`\nWould write to ${displayPath(outputDir)}/.`);

        return;
    }

    const stale = existsSync(outputDir)
        ? readdirSync(outputDir).filter(isOwnedCardFile)
        : [];

    if (stale.length > 0) {
        console.log(
            `Replacing ${stale.length} card(s) from a previous run in the same directory.`
        );
    }

    const written = await renderCards(plan, options.version, outputDir);

    for (const file of written) {
        console.log(`Wrote ${displayPath(file)}`);
    }

    console.log(
        `\nReview the images, then copy what you publish (e.g. hero.jpg → apps/website/public/blog/${slug}/hero.jpg).`
    );
}

// realpath on both sides: Node resolves symlinks for `import.meta.url` but
// not for argv[1], so reaching this script through a symlinked path would
// otherwise exit 0 having rendered nothing.
const isDirectRun = (() => {
    if (!process.argv[1]) {
        return false;
    }

    try {
        return (
            realpathSync(process.argv[1]) ===
            realpathSync(fileURLToPath(import.meta.url))
        );
    } catch {
        return false;
    }
})();

if (isDirectRun) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
