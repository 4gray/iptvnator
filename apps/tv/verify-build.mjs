import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strict as assert } from 'node:assert';
const require = createRequire(import.meta.url);
const parser = createRequire(require.resolve('eslint'))('espree');
const base = 'dist/apps/tv';
const html = readFileSync(`${base}/index.html`, 'utf8');
assert.match(html, /<script defer src="\.\/assets\/[^"]+\.js"/);
assert.doesNotMatch(html, /type="module"|modulepreload|crossorigin/);
const scripts = readdirSync(`${base}/assets`).filter((file) =>
    file.endsWith('.js')
);
assert.equal(scripts.length, 1, 'TV must ship one classic JavaScript bundle');
const code = readFileSync(`${base}/assets/${scripts[0]}`, 'utf8');
parser.parse(code, { ecmaVersion: 2018 });
assert.doesNotMatch(
    code,
    /\bglobalThis\b|Object\.fromEntries|\.flatMap\(|\.replaceAll\(|Promise\.allSettled/
);
const app = JSON.parse(readFileSync(`${base}/appinfo.json`, 'utf8'));
assert.equal(app.disableBackHistoryAPI, true);
assert.equal(app.main, 'index.html');
console.log(
    `Verified classic deferred TV bundle, ES2018 syntax and unsupported-builtin scan (${Buffer.byteLength(code)} bytes). This is not a Chromium 68 or device runtime test.`
);
