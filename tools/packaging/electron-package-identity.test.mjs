import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronBuilderConfig = JSON.parse(
    fs.readFileSync(
        join(currentDir, '..', '..', 'electron-builder.json'),
        'utf8'
    )
);

test('Linux package identity does not expose the internal Electron backend project name', () => {
    assert.equal(electronBuilderConfig.productName, 'IPTVnator');
    assert.equal(electronBuilderConfig.extraMetadata?.name, 'iptvnator');
    assert.equal(electronBuilderConfig.extraMetadata?.productName, 'IPTVnator');
    assert.equal(electronBuilderConfig.linux?.executableName, 'iptvnator');
    assert.equal(
        electronBuilderConfig.linux?.desktop?.entry?.StartupWMClass,
        'iptvnator'
    );
});

test('nx-electron packaging does not copy duplicate root package metadata', () => {
    const nxElectronExecutorPath = require.resolve(
        'nx-electron/src/executors/package/executor.js'
    );
    const nxElectronExecutor = fs.readFileSync(
        nxElectronExecutorPath,
        'utf8'
    );

    assert.doesNotMatch(nxElectronExecutor, /['"]\.\/package\.json['"]/);
    assert.match(
        nxElectronExecutor,
        /filter:\s*\[['"]index\.js['"],\s*['"]package\.json['"]\]/
    );
});
