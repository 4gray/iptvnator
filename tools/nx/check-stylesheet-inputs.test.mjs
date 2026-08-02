import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import {
    extractRelativeImports,
    resolveStylesheet,
    stripScssComments,
    validateScanCoverage,
    validateStylesheetInputs,
} from './check-stylesheet-inputs.mjs';

/**
 * Mirrors the real workspace shape: one app with a build target that depends on
 * a UI library, plus a shared stylesheet directory the library imports by
 * relative path.
 */
function graphWithSharedStyles({ stylesProjectDeclared }) {
    const nodes = {
        web: { data: { root: 'apps/web', targets: { build: {} } } },
        components: { data: { root: 'libs/ui/components' } },
    };
    const dependencies = { web: [{ target: 'components' }], components: [] };

    if (stylesProjectDeclared) {
        nodes['ui-styles'] = { data: { root: 'libs/ui/styles' } };
        dependencies['ui-styles'] = [];
        dependencies.components = [{ target: 'ui-styles' }];
    }

    return { nodes, dependencies };
}

const sharedStyleImport = (targetProject) => ({
    sourceFile: 'libs/ui/components/src/lib/a.component.scss',
    specifier: '../../../../styles/detail-view',
    targetFile: 'libs/ui/styles/_detail-view.scss',
    sourceProject: 'components',
    targetProject,
});

test('flags a shared stylesheet that belongs to no Nx project', () => {
    const diagnostics = validateStylesheetInputs({
        imports: [sharedStyleImport(null)],
        graph: graphWithSharedStyles({ stylesProjectDeclared: false }),
    });

    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /belongs to no Nx project/);
    assert.match(diagnostics[0], /libs\/ui\/styles\/_detail-view\.scss/);
});

test('flags a stylesheet project outside the consuming build closure', () => {
    const graph = graphWithSharedStyles({ stylesProjectDeclared: true });
    graph.dependencies.components = [];

    const diagnostics = validateStylesheetInputs({
        imports: [sharedStyleImport('ui-styles')],
        graph,
    });

    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /web:build compiles/);
    assert.match(diagnostics[0], /stale cache/);
    assert.match(
        diagnostics[0],
        /"implicitDependencies": \["ui-styles"\] to the "components" project/
    );
});

test('accepts a stylesheet project inside the consuming build closure', () => {
    const diagnostics = validateStylesheetInputs({
        imports: [sharedStyleImport('ui-styles')],
        graph: graphWithSharedStyles({ stylesProjectDeclared: true }),
    });

    assert.deepEqual(diagnostics, []);
});

test('accepts a library importing a stylesheet owned by the build itself', () => {
    const diagnostics = validateStylesheetInputs({
        imports: [
            {
                sourceFile: 'libs/ui/components/src/lib/groups-view.scss',
                specifier: '../../../../../../../apps/web/src/nav-list.scss',
                targetFile: 'apps/web/src/nav-list.scss',
                sourceProject: 'components',
                targetProject: 'web',
            },
        ],
        graph: graphWithSharedStyles({ stylesProjectDeclared: true }),
    });

    assert.deepEqual(diagnostics, []);
});

test('flags a stylesheet whose own directory belongs to no Nx project', () => {
    const diagnostics = validateStylesheetInputs({
        imports: [
            {
                sourceFile: 'libs/ui/styles/_index.scss',
                specifier: './portal-layout',
                targetFile: 'libs/ui/styles/_portal-layout.scss',
                sourceProject: null,
                targetProject: null,
            },
        ],
        graph: graphWithSharedStyles({ stylesProjectDeclared: false }),
    });

    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /belongs to no Nx project/);
    assert.match(diagnostics[0], /project\.json/);
});

test('fails instead of passing when the scan finds no stylesheets', () => {
    const diagnostics = validateScanCoverage([]);

    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0], /No stylesheets were scanned/);
});

test('reports no scan-coverage problem once stylesheets are found', () => {
    assert.deepEqual(
        validateScanCoverage(['libs/ui/styles/_detail-view.scss']),
        []
    );
});

test('ignores relative @use examples written inside comments', () => {
    const source = [
        '// @use "../../../../../../ui/styles/portal-layout" as portal;',
        '/* @use "../../nope/from-block-comment"; */',
        "@use '../real/partial' as real;",
        "@use 'sass:math';",
    ].join('\n');

    assert.deepEqual(extractRelativeImports(source), ['../real/partial']);
});

test('keeps protocol slashes intact when stripping line comments', () => {
    const stripped = stripScssComments(
        "$font: url('https://example.test/f.woff2'); // trailing note"
    );

    assert.match(stripped, /https:\/\/example\.test/);
    assert.doesNotMatch(stripped, /trailing note/);
});

test('resolves a specifier to its Sass partial file', () => {
    const existing = new Set([
        path.resolve('/repo/libs/ui/styles/_detail-view.scss'),
    ]);

    const resolved = resolveStylesheet(
        '/repo/libs/ui/components/src/a.scss',
        '../../styles/detail-view',
        (candidate) => existing.has(candidate)
    );

    assert.equal(
        resolved,
        path.resolve('/repo/libs/ui/styles/_detail-view.scss')
    );
});
