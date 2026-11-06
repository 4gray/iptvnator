import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageTizenPackage, verifyTizenPackage } from './tizen-package.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'tv-tizen-package-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const build = join(root, 'dist/apps/tv');
    mkdirSync(join(build, 'assets'), { recursive: true });
    mkdirSync(join(root, 'apps/tv/tizen'), { recursive: true });
    cpSync(
        new URL('./tizen/config.xml', import.meta.url),
        join(root, 'apps/tv/tizen/config.xml')
    );
    writeFileSync(
        join(build, 'appinfo.json'),
        JSON.stringify({
            version: '0.1.25',
            main: 'index.html',
            disableBackHistoryAPI: true,
        })
    );
    writeFileSync(
        join(build, 'index.html'),
        '<html><head><script defer src="./assets/tv.js"></script></head><body></body></html>'
    );
    writeFileSync(
        join(build, 'assets/tv.js'),
        '(function () { const compatible = 1; })();'
    );
    writeFileSync(join(build, 'icon.png'), 'synthetic icon');
    writeFileSync(join(build, 'large-icon.png'), 'synthetic LG icon');
    return { root, build };
}

test('Tizen staging reuses the verified bundle/version/icon and leaves LG files byte-identical', (t) => {
    const { root, build } = fixture(t);
    const before = readdirSync(build)
        .filter((name) => name !== 'assets')
        .map((name) => [name, readFileSync(join(build, name))]);
    const input = stageTizenPackage(root);
    assert.equal(
        verifyTizenPackage(input),
        readFileSync(join(build, 'assets/tv.js')).length
    );
    assert.deepEqual(
        readFileSync(join(input, 'assets/tv.js')),
        readFileSync(join(build, 'assets/tv.js'))
    );
    assert.deepEqual(
        readFileSync(join(input, 'icon.png')),
        readFileSync(join(build, 'icon.png'))
    );
    assert.match(
        readFileSync(join(input, 'config.xml'), 'utf8'),
        /version="0.1.25"/
    );
    assert.equal(existsSync(join(input, 'large-icon.png')), false);
    assert.equal(existsSync(join(input, 'appinfo.json')), false);
    assert.equal(existsSync(join(build, 'config.xml')), false);
    const html = readFileSync(join(input, 'index.html'), 'utf8');
    assert.match(
        html,
        /<script src="\$WEBAPIS\/webapis\/webapis\.js"><\/script>/
    );
    assert.ok(html.indexOf('$WEBAPIS/') < html.indexOf('./assets/tv.js'));
    assert.doesNotMatch(
        readFileSync(join(build, 'index.html'), 'utf8'),
        /WEBAPIS/
    );
    for (const [name, bytes] of before)
        assert.deepEqual(readFileSync(join(build, name)), bytes);
    writeFileSync(
        join(input, 'obsolete.wgt'),
        'stale package must not be re-signed'
    );
    stageTizenPackage(root);
    assert.equal(existsSync(join(input, 'obsolete.wgt')), false);
});

for (const [name, change] of [
    [
        'missing Samsung API script',
        (input) =>
            writeFileSync(
                join(input, 'index.html'),
                '<script defer src="./assets/tv.js"></script>'
            ),
    ],
    [
        'module script',
        (input) =>
            writeFileSync(
                join(input, 'index.html'),
                '<script type="module" src="./assets/tv.js"></script>'
            ),
    ],
    [
        'modern syntax',
        (input) =>
            writeFileSync(
                join(input, 'assets/tv.js'),
                'const invalid = window?.tizen;'
            ),
    ],
    [
        'unsupported builtin',
        (input) =>
            writeFileSync(
                join(input, 'assets/tv.js'),
                'Object.fromEntries([]);'
            ),
    ],
    [
        'multiple bundles',
        (input) => writeFileSync(join(input, 'assets/extra.js'), 'void 0;'),
    ],
    [
        'LG metadata',
        (input) => writeFileSync(join(input, 'appinfo.json'), '{}'),
    ],
    ['missing icon', (input) => rmSync(join(input, 'icon.png'))],
    [
        'old engine',
        (input) =>
            writeFileSync(
                join(input, 'config.xml'),
                readFileSync(join(input, 'config.xml'), 'utf8').replace(
                    'required_version="5.5"',
                    'required_version="5.0"'
                )
            ),
    ],
    [
        'extra privilege',
        (input) =>
            writeFileSync(
                join(input, 'config.xml'),
                readFileSync(join(input, 'config.xml'), 'utf8').replace(
                    '</widget>',
                    '<tizen:privilege name="http://tizen.org/privilege/filesystem.read"/></widget>'
                )
            ),
    ],
    [
        'malformed XML',
        (input) => writeFileSync(join(input, 'config.xml'), '<widget>'),
    ],
]) {
    test('Tizen verification rejects ' + name, (t) => {
        const { root } = fixture(t);
        const input = stageTizenPackage(root);
        change(input);
        assert.throws(() => verifyTizenPackage(input));
    });
}
