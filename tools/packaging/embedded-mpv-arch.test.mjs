import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    isForeignLinuxEmbeddedMpvArch,
    linuxUnpackedDirArch,
    resolveElectronBuilderArchName,
    validatePackagedEmbeddedMpv,
} = require('./embedded-mpv-packaging.cjs');

const X64_ADDON_ENV = { IPTVNATOR_EMBEDDED_MPV_ARCH: 'x64' };

test('resolveElectronBuilderArchName maps builder-util Arch enum values', () => {
    assert.equal(resolveElectronBuilderArchName(0), 'ia32');
    assert.equal(resolveElectronBuilderArchName(1), 'x64');
    assert.equal(resolveElectronBuilderArchName(2), 'armv7l');
    assert.equal(resolveElectronBuilderArchName(3), 'arm64');
    assert.equal(resolveElectronBuilderArchName('arm64'), 'arm64');
    assert.equal(resolveElectronBuilderArchName(99), null);
});

test('flags Linux packages whose arch differs from the built addon', () => {
    assert.equal(isForeignLinuxEmbeddedMpvArch('linux', 3, X64_ADDON_ENV), true);
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('linux', 'armv7l', X64_ADDON_ENV),
        true
    );
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('linux', 'x64', X64_ADDON_ENV),
        false
    );
    // Only Linux fans out foreign arches from one dist tree.
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('darwin', 'arm64', X64_ADDON_ENV),
        false
    );
    assert.equal(
        isForeignLinuxEmbeddedMpvArch('win32', 'arm64', X64_ADDON_ENV),
        false
    );
});

test('derives package arch from electron-builder Linux output directory names', () => {
    assert.equal(linuxUnpackedDirArch('linux-unpacked'), 'x64');
    assert.equal(linuxUnpackedDirArch('linux-arm64-unpacked'), 'arm64');
    assert.equal(linuxUnpackedDirArch('linux-armv7l-unpacked'), 'armv7l');
    assert.equal(linuxUnpackedDirArch('mac-arm64'), null);
    assert.equal(linuxUnpackedDirArch('win-unpacked'), null);
});

function createResourceDir(files) {
    const resourceDir = fs.mkdtempSync(
        join(os.tmpdir(), 'iptvnator-embedded-mpv-arch-')
    );
    const nativeDir = join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    fs.mkdirSync(nativeDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(join(nativeDir, name), content);
    }
    return resourceDir;
}

test('foreign-arch validation requires the unavailable marker and forbids the addon', (t) => {
    const withMarker = createResourceDir({
        'embedded-mpv-unavailable.txt': 'not bundled for arm64\n',
    });
    const withAddon = createResourceDir({
        'embedded-mpv-unavailable.txt': 'not bundled for arm64\n',
        'embedded_mpv.node': 'x64 machine code',
    });
    const empty = createResourceDir({});
    t.after(() => {
        for (const dir of [withMarker, withAddon, empty]) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    assert.deepEqual(
        validatePackagedEmbeddedMpv(withMarker, {
            platform: 'linux',
            required: true,
            foreignArch: true,
        }),
        []
    );

    const addonErrors = validatePackagedEmbeddedMpv(withAddon, {
        platform: 'linux',
        required: true,
        foreignArch: true,
    });
    assert.equal(addonErrors.length, 1);
    assert.match(addonErrors[0], /must not ship in foreign-architecture/);

    const markerErrors = validatePackagedEmbeddedMpv(empty, {
        platform: 'linux',
        required: true,
        foreignArch: true,
    });
    assert.equal(markerErrors.length, 1);
    assert.match(markerErrors[0], /unavailable marker/);
});

test('same-arch validation still requires the addon when embedded MPV is required', (t) => {
    const empty = createResourceDir({});
    t.after(() => fs.rmSync(empty, { recursive: true, force: true }));

    const errors = validatePackagedEmbeddedMpv(empty, {
        platform: 'linux',
        required: true,
        foreignArch: false,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Missing embedded MPV native addon/);
});
