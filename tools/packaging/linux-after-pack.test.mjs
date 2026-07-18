import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const linuxAfterPack = require('./linux-after-pack.cjs');
const { createLoaderScript } = linuxAfterPack;

const electronElf = Buffer.from([
    0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x49, 0x50, 0x54, 0x56,
]);

async function createAfterPackFixture(targets) {
    const appOutDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'iptvnator-linux-after-pack-')
    );
    const executablePath = path.join(appOutDir, 'iptvnator');
    await fs.writeFile(executablePath, electronElf, { mode: 0o755 });

    return {
        appOutDir,
        executablePath,
        params: {
            appOutDir,
            electronPlatformName: 'linux',
            targets,
            packager: {
                executableName: 'iptvnator',
                appInfo: {
                    productName: 'IPTVnator',
                },
            },
        },
    };
}

function resolveLinuxLauncherLayout(...args) {
    return require('./linux-launcher-layout.cjs').resolveLinuxLauncherLayout(
        ...args
    );
}

async function assertPathMissing(filePath) {
    await assert.rejects(
        fs.stat(filePath),
        (error) => error?.code === 'ENOENT'
    );
}

test('isolated Flatpak preserves the Electron ELF for Zypak', async (t) => {
    const fixture = await createAfterPackFixture([{ name: 'flatpak' }]);
    t.after(() =>
        fs.rm(fixture.appOutDir, {
            recursive: true,
            force: true,
        })
    );

    await linuxAfterPack(fixture.params);

    assert.deepEqual(await fs.readFile(fixture.executablePath), electronElf);
    await assertPathMissing(`${fixture.executablePath}.bin`);
});

test('resolves normalized string and Target-like launcher layouts', () => {
    assert.deepEqual(resolveLinuxLauncherLayout([' FlatPak ']), {
        targetNames: ['flatpak'],
        electronBinaryName: 'iptvnator',
        wrapperRequired: false,
    });
    assert.deepEqual(
        resolveLinuxLauncherLayout(
            [' AppImage ', { name: ' DEB ' }],
            'iptvnator-player'
        ),
        {
            targetNames: ['appimage', 'deb'],
            electronBinaryName: 'iptvnator-player.bin',
            wrapperRequired: true,
        }
    );
});

test('rejects missing, empty, and non-array target lists', () => {
    for (const targets of [undefined, null, 'flatpak', new Map(), {}]) {
        assert.throws(
            () => resolveLinuxLauncherLayout(targets),
            /Linux launcher targets must be an array/
        );
    }
    assert.throws(
        () => resolveLinuxLauncherLayout([]),
        /Linux launcher targets must contain at least one target/
    );
});

test('rejects empty target names and normalized duplicates', () => {
    for (const target of ['', '  ', {}, { name: '' }, null, 42]) {
        assert.throws(
            () => resolveLinuxLauncherLayout([target]),
            /Linux launcher targets must expose a non-empty name/
        );
    }
    assert.throws(
        () => resolveLinuxLauncherLayout([{ name: ' DEB ' }, { name: 'deb' }]),
        /Linux launcher target "deb" is duplicated/
    );
});

test('rejects Flatpak mixed with another target', () => {
    assert.throws(
        () =>
            resolveLinuxLauncherLayout([
                { name: 'flatpak' },
                { name: 'AppImage' },
            ]),
        /Flatpak must be packaged in an isolated Electron Builder pass so Zypak receives the Electron ELF directly/
    );
});

for (const targetName of ['appimage', 'deb', 'rpm', 'pacman', 'snap']) {
    test(`${targetName} retains the launcher wrapper and Electron ELF binary`, async (t) => {
        const fixture = await createAfterPackFixture([{ name: targetName }]);
        t.after(() =>
            fs.rm(fixture.appOutDir, {
                recursive: true,
                force: true,
            })
        );

        await linuxAfterPack(fixture.params);

        assert.equal(
            await fs.readFile(fixture.executablePath, 'utf8'),
            createLoaderScript({
                executableName: 'iptvnator',
                productName: 'IPTVnator',
            })
        );
        assert.deepEqual(
            await fs.readFile(`${fixture.executablePath}.bin`),
            electronElf
        );
        assert.equal(
            (await fs.stat(fixture.executablePath)).mode & 0o777,
            0o755
        );
    });
}

test('mixed Flatpak targets fail before mutating the Electron ELF', async (t) => {
    const fixture = await createAfterPackFixture([
        { name: 'flatpak' },
        { name: 'appimage' },
    ]);
    t.after(() =>
        fs.rm(fixture.appOutDir, {
            recursive: true,
            force: true,
        })
    );

    await assert.rejects(
        linuxAfterPack(fixture.params),
        /Flatpak must be packaged in an isolated Electron Builder pass so Zypak receives the Electron ELF directly/
    );

    assert.deepEqual(await fs.readFile(fixture.executablePath), electronElf);
    await assertPathMissing(`${fixture.executablePath}.bin`);
});

test('packaging Nx tests register the Linux afterPack regression suite', async () => {
    const project = JSON.parse(
        await fs.readFile(new URL('./project.json', import.meta.url), 'utf8')
    );
    const testFile =
        '{workspaceRoot}/tools/packaging/linux-after-pack.test.mjs';

    assert.ok(project.targets.test.inputs.includes(testFile));
    assert.match(
        project.targets.test.options.command,
        /node --test .*tools\/packaging\/linux-after-pack\.test\.mjs/
    );
});
