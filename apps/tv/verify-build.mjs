import { existsSync, readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { verifyTvBundle } from './build-check.mjs';
import { stageTizenPackage } from './tizen-package.mjs';
const base = 'dist/apps/tv';
const bytes = verifyTvBundle(base);
const app = JSON.parse(readFileSync(base + '/appinfo.json', 'utf8'));
assert.equal(app.disableBackHistoryAPI, true);
assert.equal(app.main, 'index.html');
assert.equal(
    existsSync(base + '/config.xml'),
    false,
    'LG input must exclude Tizen metadata'
);
stageTizenPackage(process.cwd());
console.log(
    'Verified LG and Tizen inputs: classic deferred TV bundle, ES2018 syntax and unsupported-builtin scan (' +
        bytes +
        ' bytes). This is not a Chromium 68 or device runtime test.'
);
