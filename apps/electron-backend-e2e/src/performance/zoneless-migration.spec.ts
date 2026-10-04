/* eslint-disable playwright/expect-expect -- These are Node assertion-based repository contract tests. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// docs/architecture/zoneless-migration.md lists every component that still
// opts out of OnPush. This keeps the checklist and the code in step: a new
// Eager component fails here, and so does a converted one left unticked.

const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const checklistPath = 'docs/architecture/zoneless-migration.md';
const sourceRoots = ['apps', 'libs'];
const skippedDirectories = new Set([
    'node_modules',
    'dist',
    'coverage',
    'test-stubs',
]);
// Test-only files follow the repository's `.spec` / `.test` naming, with an
// optional suffix (`.spec-stubs.ts`, `.test-helpers.ts`, `.test-stubs.ts`).
const testOnlyFile = /(\.(spec|test)(-[\w]+)?|^test-setup)\.ts$/;

function listProductionSources(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (skippedDirectories.has(entry.name)) continue;
            if (entry.name.endsWith('-e2e')) continue;
            files.push(...listProductionSources(path));
        } else if (
            entry.name.endsWith('.ts') &&
            !entry.name.endsWith('.d.ts') &&
            !testOnlyFile.test(entry.name)
        ) {
            files.push(relative(workspaceRoot, path).split(sep).join('/'));
        }
    }
    return files;
}

function readSources(): Map<string, string> {
    const sources = new Map<string, string>();
    for (const root of sourceRoots) {
        for (const file of listProductionSources(join(workspaceRoot, root))) {
            sources.set(file, readFileSync(join(workspaceRoot, file), 'utf8'));
        }
    }
    return sources;
}

function readEagerChecklist(): { open: string[]; done: string[] } {
    const markdown = readFileSync(join(workspaceRoot, checklistPath), 'utf8');
    const section = markdown.split(/^## Eager components$/m)[1];
    assert.ok(
        section,
        `${checklistPath} must have an "Eager components" section`
    );
    const body = section.split(/^## /m)[0];
    const open: string[] = [];
    const done: string[] = [];
    for (const match of body.matchAll(/^- \[( |x)\] `([^`]+\.ts)`/gm)) {
        (match[1] === 'x' ? done : open).push(match[2]);
    }
    return { open: open.sort(), done: done.sort() };
}

const sources = readSources();

test('the zoneless checklist lists exactly the components that are still Eager', () => {
    const eager = [...sources]
        .filter(([, text]) => text.includes('ChangeDetectionStrategy.Eager'))
        .map(([file]) => file)
        .sort();
    const { open } = readEagerChecklist();

    assert.deepEqual(
        eager,
        open,
        `Production files with ChangeDetectionStrategy.Eager must match the unticked entries in ${checklistPath}. ` +
            'Do not add Eager components; tick an entry when its component is converted.'
    );
});

test('ticked checklist entries name files that exist', () => {
    for (const file of readEagerChecklist().done) {
        assert.ok(sources.has(file), `${file} is ticked but does not exist`);
    }
});

test('no production component uses the deprecated Default strategy alias', () => {
    for (const [file, text] of sources) {
        assert.doesNotMatch(text, /ChangeDetectionStrategy\.Default\b/, file);
    }
});
