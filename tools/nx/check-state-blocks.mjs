import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseTemplate,
    TmplAstElement,
    TmplAstRecursiveVisitor,
    tmplAstVisitAll,
} from '@angular/compiler';

import { inlineTemplates } from './inline-templates.mjs';

/**
 * Empty, no-results, error and offline states render through
 * `app-state-view` (`@iptvnator/ui/state`, UI-44). Before it, about 57
 * `empty-*` classes in 34 files drew their own icon, title and hint. This
 * guard has two parts:
 *
 * - a ratchet on the bespoke empty blocks that remain: an element whose
 *   static class names an `empty` or `no-results` block, counted once per
 *   outermost element. Each file may hold at most the count recorded in
 *   `state-blocks-baseline.json`, with the reason it stays bespoke. Counts
 *   only go down: `--update` lowers or drops entries and never raises one;
 * - the spinner scale: every `mat-spinner` / `mat-progress-spinner`
 *   diameter is 16, 24 or 40 (`SPINNER_DIAMETERS`).
 */
export const BASELINE_FILE = 'tools/nx/state-blocks-baseline.json';
export const SPINNER_SCALE = new Set([16, 24, 40]);

const SCANNED_PATHSPECS = [
    'apps/web/*.html',
    'apps/web/*.ts',
    'libs/*.html',
    'libs/*.ts',
];

function isScanned(file) {
    return (
        !file.startsWith('libs/ui/state/') &&
        !/\.(spec|test)\.[cm]?[jt]s$/.test(file) &&
        !/\.spec-stubs\.ts$/.test(file) &&
        !file.includes('/testing/')
    );
}

/** A class token names an empty block: `empty-state`, `grid-empty-state`. */
export function isEmptyBlockClass(token) {
    const block = token.split('__')[0].split('--')[0];
    return block.split('-').includes('empty') || block.includes('no-results');
}

const SPINNER_TAGS = new Set(['mat-spinner', 'mat-progress-spinner']);

/**
 * The shared views: a class on them is a layout or test hook, not a bespoke
 * block, and their content is projected into the shared markup.
 */
export const SHARED_STATE_TAGS = new Set(['app-state-view']);

class StateVisitor extends TmplAstRecursiveVisitor {
    constructor(lineAt) {
        super();
        this.lineAt = lineAt;
        this.depth = 0;
        this.blocks = [];
        this.spinners = [];
    }

    visitElement(element) {
        const line = this.lineAt(element.startSourceSpan.start.offset) + 1;
        if (SPINNER_TAGS.has(element.name)) {
            this.checkSpinner(element, line);
        }
        if (SHARED_STATE_TAGS.has(element.name)) {
            super.visitElement(element);
            return;
        }
        const classAttr = element.attributes.find(
            (attr) => attr.name === 'class'
        );
        const block = classAttr?.value
            .split(/\s+/)
            .filter(Boolean)
            .find(isEmptyBlockClass);
        if (block && this.depth === 0) {
            this.blocks.push({ line, block });
        }
        if (block) this.depth += 1;
        super.visitElement(element);
        if (block) this.depth -= 1;
    }

    checkSpinner(element, line) {
        const literal = element.attributes.find(
            (attr) => attr.name === 'diameter'
        );
        const bound = element.inputs.find((input) => input.name === 'diameter');
        if (literal) {
            if (!SPINNER_SCALE.has(Number(literal.value))) {
                this.spinners.push({ line, diameter: literal.value });
            }
        } else if (bound) {
            const source = bound.value?.source ?? '';
            const value = Number(source.trim());
            const onScale =
                /SPINNER_DIAMETERS\.(sm|md|lg)\b/.test(source) ||
                SPINNER_SCALE.has(value);
            if (!onScale) {
                this.spinners.push({ line, diameter: source.trim() });
            }
        } else {
            // Material's default is 100px, off the scale.
            this.spinners.push({ line, diameter: 'default (100)' });
        }
    }
}

/** Bespoke empty blocks and off-scale spinners of one template. */
export function stateFindingsInTemplate(
    template,
    file,
    lineAt = (offset) => template.slice(0, offset).split('\n').length - 1
) {
    const parsed = parseTemplate(template, file, {
        preserveWhitespaces: true,
    });
    if (parsed.errors?.length) {
        throw new Error(
            `${file}: cannot parse template: ${parsed.errors[0].msg}`
        );
    }
    const visitor = new StateVisitor(lineAt);
    tmplAstVisitAll(visitor, parsed.nodes);
    return { blocks: visitor.blocks, spinners: visitor.spinners };
}

/** Findings of one source file: its own template or its inline ones. */
export function findStateFindings(file, source) {
    const templates = file.endsWith('.html')
        ? [{ template: source, lineAt: undefined }]
        : inlineTemplates(source, file);
    const blocks = [];
    const spinners = [];
    for (const { template, lineAt } of templates) {
        const found = stateFindingsInTemplate(template, file, lineAt);
        blocks.push(...found.blocks.map((entry) => ({ file, ...entry })));
        spinners.push(...found.spinners.map((entry) => ({ file, ...entry })));
    }
    return { blocks, spinners };
}

/**
 * Compares per-file block counts with the baseline. A file over its entry
 * (or absent from it) fails; a file under it is stale and reported.
 */
export function compareWithBaseline(counts, baseline) {
    const over = [];
    const stale = [];
    for (const [file, count] of Object.entries(counts)) {
        const allowed = baseline[file]?.count ?? 0;
        if (count > allowed) over.push({ file, count, allowed });
    }
    for (const [file, entry] of Object.entries(baseline)) {
        const count = counts[file] ?? 0;
        if (count < entry.count)
            stale.push({ file, count, allowed: entry.count });
    }
    return { over, stale };
}

/** The baseline lowered to the current counts; never raised. */
export function loweredBaseline(counts, baseline) {
    const next = {};
    for (const [file, entry] of Object.entries(baseline)) {
        const count = Math.min(entry.count, counts[file] ?? 0);
        if (count > 0) next[file] = { ...entry, count };
    }
    return next;
}

/** Tracked renderer files the guard reads, at any depth. */
export function listScannedFiles(rootDir) {
    return execFileSync('git', ['ls-files', ...SCANNED_PATHSPECS], {
        cwd: rootDir,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    })
        .trim()
        .split('\n')
        .filter(Boolean)
        .filter(isScanned);
}

const isMain =
    process.argv[1] &&
    path.resolve(process.argv[1]) ===
        path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const rootDir = process.cwd();
    const update = process.argv.includes('--update');
    const files = listScannedFiles(rootDir);
    const baselinePath = path.join(rootDir, BASELINE_FILE);
    const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));

    const blocks = [];
    const spinners = [];
    for (const file of files) {
        const source = await readFile(path.join(rootDir, file), 'utf8');
        const found = findStateFindings(file, source);
        blocks.push(...found.blocks);
        spinners.push(...found.spinners);
    }
    const counts = {};
    for (const { file } of blocks) counts[file] = (counts[file] ?? 0) + 1;
    const { over, stale } = compareWithBaseline(counts, baseline);

    if (update) {
        const next = loweredBaseline(counts, baseline);
        await writeFile(baselinePath, `${JSON.stringify(next, null, 4)}\n`);
        console.log(`Lowered ${BASELINE_FILE} to the current counts.`);
    }

    let failed = false;
    if (over.length > 0) {
        failed = true;
        console.error(
            'Bespoke empty blocks above the baseline. Render the state with app-state-view (@iptvnator/ui/state) instead; the baseline only goes down:'
        );
        for (const { file, count, allowed } of over) {
            const lines = blocks
                .filter((entry) => entry.file === file)
                .map(({ line, block }) => `${line} .${block}`)
                .join(', ');
            console.error(
                `- ${file}: ${count} (allowed ${allowed}) at ${lines}`
            );
        }
    }
    if (spinners.length > 0) {
        failed = true;
        console.error(
            'Spinners off the scale. Use a diameter of 16, 24 or 40 (SPINNER_DIAMETERS sm / md / lg):'
        );
        for (const { file, line, diameter } of spinners) {
            console.error(`- ${file}:${line} diameter ${diameter}`);
        }
    }
    if (stale.length > 0 && !update) {
        console.log(
            `${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} above the current count; run \`pnpm run ui:states:update\` to lower ${BASELINE_FILE}:`
        );
        for (const { file, count, allowed } of stale) {
            console.log(`- ${file}: ${count} (baseline ${allowed})`);
        }
    }
    if (failed) {
        process.exitCode = 1;
    } else {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        console.log(
            `Checked ${files.length} renderer files: ${total} bespoke empty block${total === 1 ? '' : 's'} within the baseline, every spinner on the scale.`
        );
    }
}
