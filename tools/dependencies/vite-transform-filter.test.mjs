import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const angularBuildRequire = createRequire(
    require.resolve('@angular/build/package.json')
);
const vitePackagePath = angularBuildRequire.resolve('vite/package.json');
const vitePackage = JSON.parse(await readFile(vitePackagePath, 'utf8'));
const viteConfigPath = join(
    dirname(vitePackagePath),
    'dist/node/chunks/config.js'
);
const viteConfig = await readFile(viteConfigPath, 'utf8');

function extractRegExp(name) {
    const declaration = new RegExp(
        `const ${name} = (\\/[^\\n]+\\/[a-z]*);`
    ).exec(viteConfig);
    assert.ok(declaration, `Unable to find ${name} in ${viteConfigPath}`);
    return runInNewContext(declaration[1]);
}

test('pins the Vite version carrying the local transform-filter backport', () => {
    assert.equal(vitePackage.version, '7.3.6');
});

test('uses bounded Vite prefilters with precise handler matchers', () => {
    assert.ok(
        /filter: \{\s*id: \{[^}]+\},\s*code: assetImportMetaUrlFilterRE\s*\}/s.test(
            viteConfig
        ),
        'asset import-meta transform must use the bounded prefilter'
    );
    assert.ok(
        /filter: \{ code: workerImportMetaUrlFilterRE \}/.test(viteConfig),
        'worker import-meta transform must use the bounded prefilter'
    );
    assert.ok(
        /const re = new RegExp\(assetImportMetaUrlRE\)/.test(viteConfig),
        'asset handler must clone the precise matcher'
    );
    assert.ok(
        /const re = new RegExp\(workerImportMetaUrlRE\)/.test(viteConfig),
        'worker handler must clone the precise matcher'
    );
    assert.ok(
        !/code: \/new\\s\+URL\.\+import\\\.meta\\\.url\/s/.test(viteConfig),
        'the backtracking asset transform prefilter must be absent'
    );
});

test('rejects a large false-positive chunk without regex backtracking', () => {
    const assetFilter = extractRegExp('assetImportMetaUrlFilterRE');
    const workerFilter = extractRegExp('workerImportMetaUrlFilterRE');
    const largeCode =
        `new URLSearchParams();\n`.repeat(200) + `var a = 1;\n`.repeat(200_000);
    const start = performance.now();

    assert.equal(assetFilter.test(largeCode), false);
    assert.equal(workerFilter.test(largeCode), false);
    assert.ok(
        performance.now() - start < 250,
        'Vite transform filters must reject the stress input without backtracking'
    );
});

test('keeps valid asset and worker import-meta URL patterns eligible', () => {
    const assetFilter = extractRegExp('assetImportMetaUrlFilterRE');
    const workerFilter = extractRegExp('workerImportMetaUrlFilterRE');
    const assetMatcher = extractRegExp('assetImportMetaUrlRE');
    const workerMatcher = extractRegExp('workerImportMetaUrlRE');
    const assetExpression = `new URL('./asset.png', import.meta.url)`;
    const workerExpression = `new Worker(new URL('./worker.js', import.meta.url))`;

    assert.equal(assetFilter.test(assetExpression), true);
    assert.equal(workerFilter.test(workerExpression), true);
    assert.equal(assetMatcher.test(assetExpression), true);
    assert.equal(workerMatcher.test(workerExpression), true);
});

test('keeps comment-bearing import-meta URL patterns eligible', () => {
    const assetFilter = extractRegExp('assetImportMetaUrlFilterRE');
    const workerFilter = extractRegExp('workerImportMetaUrlFilterRE');

    assert.equal(
        assetFilter.test(`new URL(/* keep */ './asset.png', import.meta.url)`),
        true
    );
    assert.equal(
        workerFilter.test(
            `new Worker(/* keep */ new URL('./worker.js', import.meta.url))`
        ),
        true
    );
});
