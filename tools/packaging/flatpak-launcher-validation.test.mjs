import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    validateFlatpakLauncher,
} = require('./flatpak-launcher-validation.cjs');

const executableName = 'iptvnator';
const electronElf = Buffer.from([
    0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00,
]);

async function createFixture(t) {
    const appDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'iptvnator-flatpak-launcher-')
    );
    t.after(() => fs.rm(appDir, { recursive: true, force: true }));

    return {
        appDir,
        launcherPath: path.join(appDir, executableName),
        siblingPath: path.join(appDir, `${executableName}.bin`),
    };
}

async function writeLauncher(launcherPath, contents, mode) {
    await fs.writeFile(launcherPath, contents);
    await fs.chmod(launcherPath, mode);
}

test('accepts a regular executable Flatpak Electron ELF', async (t) => {
    const fixture = await createFixture(t);
    await writeLauncher(fixture.launcherPath, electronElf, 0o755);

    assert.deepEqual(
        validateFlatpakLauncher(fixture.appDir, executableName),
        []
    );
});

test('rejects a symlinked Flatpak Electron launcher', async (t) => {
    const fixture = await createFixture(t);
    const electronTargetPath = path.join(fixture.appDir, 'electron-target');
    await writeLauncher(electronTargetPath, electronElf, 0o755);
    await fs.symlink(electronTargetPath, fixture.launcherPath);

    assert.deepEqual(validateFlatpakLauncher(fixture.appDir, executableName), [
        `Flatpak Electron launcher must be a regular file: ${fixture.launcherPath}`,
    ]);
});

test('rejects a dangling Flatpak launcher binary sibling', async (t) => {
    const fixture = await createFixture(t);
    await writeLauncher(fixture.launcherPath, electronElf, 0o755);
    await fs.symlink('missing-electron', fixture.siblingPath);

    assert.deepEqual(validateFlatpakLauncher(fixture.appDir, executableName), [
        `Flatpak Electron layout must not include a launcher binary sibling: ${fixture.siblingPath}`,
    ]);
});

test('rejects a non-executable regular Flatpak Electron ELF', async (t) => {
    const fixture = await createFixture(t);
    await writeLauncher(fixture.launcherPath, electronElf, 0o644);

    assert.deepEqual(validateFlatpakLauncher(fixture.appDir, executableName), [
        `Flatpak Electron launcher must be executable: ${fixture.launcherPath}`,
    ]);
});

for (const [description, contents] of [
    ['short ELF magic', Buffer.from([0x7f, 0x45, 0x4c])],
    ['incorrect ELF magic', Buffer.from([0x00, 0x45, 0x4c, 0x46])],
]) {
    test(`rejects ${description} in the Flatpak Electron launcher`, async (t) => {
        const fixture = await createFixture(t);
        await writeLauncher(fixture.launcherPath, contents, 0o755);

        assert.deepEqual(
            validateFlatpakLauncher(fixture.appDir, executableName),
            [
                `Flatpak Electron launcher must be an ELF binary: ${fixture.launcherPath}`,
            ]
        );
    });
}

test('packaging Nx tests register the Flatpak launcher validation suite', async () => {
    const project = JSON.parse(
        await fs.readFile(new URL('./project.json', import.meta.url), 'utf8')
    );
    const moduleFile =
        '{workspaceRoot}/tools/packaging/flatpak-launcher-validation.cjs';
    const testFile =
        '{workspaceRoot}/tools/packaging/flatpak-launcher-validation.test.mjs';

    assert.ok(project.targets.test.inputs.includes(moduleFile));
    assert.ok(project.targets.test.inputs.includes(testFile));
    assert.match(
        project.targets.test.options.command,
        /node --test .*tools\/packaging\/flatpak-launcher-validation\.test\.mjs/
    );
});
