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
    assert.equal(vitePackage.version, '7.3.5');
});

test('uses precise Vite transform filters instead of backtracking prefilters', () => {
    assert.ok(
        /filter: \{\s*id: \{[^}]+\},\s*code: assetImportMetaUrlRE\s*\}/s.test(
            viteConfig
        ),
        'asset import-meta transform must use the precise shared filter'
    );
    assert.ok(
        /filter: \{ code: workerImportMetaUrlRE \}/.test(viteConfig),
        'worker import-meta transform must use the precise shared filter'
    );
    assert.ok(
        !/code: \/new\\s\+URL\.\+import\\\.meta\\\.url\/s/.test(viteConfig),
        'the backtracking asset transform prefilter must be absent'
    );
});

test('rejects a large false-positive chunk without regex backtracking', () => {
    const assetFilter = extractRegExp('assetImportMetaUrlRE');
    const workerFilter = extractRegExp('workerImportMetaUrlRE');
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
    const assetFilter = extractRegExp('assetImportMetaUrlRE');
    const workerFilter = extractRegExp('workerImportMetaUrlRE');

    assert.equal(
        assetFilter.test(`new URL('./asset.png', import.meta.url)`),
        true
    );
    assert.equal(
        workerFilter.test(
            `new Worker(new URL('./worker.js', import.meta.url))`
        ),
        true
    );
});
