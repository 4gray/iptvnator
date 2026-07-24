import assert = require('node:assert/strict');
import {
    chmodSync,
    existsSync,
    lstatSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
    createDisposablePackagedLinuxApp,
    createPackagedEntryGuard,
    readPackagedRuntimeIdentity,
} from './embedded-mpv-frame-copy-packaged-filesystem';

const temporaryDirectories = new Set<string>();

type PackageFixture = {
    executablePath: string;
    libmpvAliasPath: string;
    libmpvSonamePath: string;
    nativeDir: string;
    packageRoot: string;
    payloadPath: string;
    runtimeManifestPath: string;
};

function createPackageFixture(): PackageFixture {
    const packageRoot = mkdtempSync(
        join(tmpdir(), 'iptvnator-packaged-fixture-source-')
    );
    temporaryDirectories.add(packageRoot);
    const executablePath = join(packageRoot, 'IPTVnator');
    const nativeDir = join(
        packageRoot,
        'resources',
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    const payloadPath = join(packageRoot, 'resources', 'payload.bin');
    const runtimeManifestPath = join(nativeDir, 'embedded-mpv-runtime.json');
    const runtimeLibraryDir = join(nativeDir, 'lib');
    const libmpvSonamePath = join(runtimeLibraryDir, 'libmpv.so.2');
    const libmpvAliasPath = join(runtimeLibraryDir, 'libmpv.so');

    mkdirSync(runtimeLibraryDir, { recursive: true });
    writeFileSync(executablePath, '#!/bin/sh\nexit 0\n');
    chmodSync(executablePath, 0o755);
    writeFileSync(payloadPath, 'packaged payload');
    chmodSync(payloadPath, 0o640);
    writeFileSync(libmpvSonamePath, 'packaged libmpv');
    symlinkSync('libmpv.so.2', libmpvAliasPath);
    writeFileSync(
        runtimeManifestPath,
        JSON.stringify({
            arch: 'x64',
            libmpvSoname: 'libmpv.so.2',
            platform: 'linux',
            profile: 'portable',
            runtimeMode: 'bundled',
        })
    );

    if (process.platform !== 'win32') {
        symlinkSync(
            'payload.bin',
            join(packageRoot, 'resources', 'payload-link')
        );
    }

    return {
        executablePath,
        libmpvAliasPath,
        libmpvSonamePath,
        nativeDir,
        packageRoot,
        payloadPath,
        runtimeManifestPath,
    };
}

function entryExists(entryPath: string): boolean {
    try {
        lstatSync(entryPath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

afterEach(() => {
    for (const directory of temporaryDirectories) {
        rmSync(directory, { force: true, recursive: true });
    }
    temporaryDirectories.clear();
});

describe('disposable unpacked package clone', () => {
    it('requires a safe versioned libmpv target in the packaged manifest', () => {
        const source = createPackageFixture();

        assert.equal(
            readPackagedRuntimeIdentity(source.nativeDir).libmpvSoname,
            'libmpv.so.2'
        );

        writeFileSync(
            source.runtimeManifestPath,
            JSON.stringify({
                arch: 'x64',
                libmpvSoname: '../libmpv.so.2',
                platform: 'linux',
                profile: 'portable',
                runtimeMode: 'bundled',
            })
        );
        assert.throws(
            () => readPackagedRuntimeIdentity(source.nativeDir),
            /libmpvSoname/
        );
    });

    it('hides and restores a cloned regular dependency without changing the source package', () => {
        const source = createPackageFixture();
        const clone = createDisposablePackagedLinuxApp(source.executablePath);
        temporaryDirectories.add(clone.temporaryRoot);

        const clonedLibmpvPath = join(clone.nativeDir, 'lib', 'libmpv.so.2');
        const guard = createPackagedEntryGuard(clonedLibmpvPath, {
            expectedKind: 'regular-file',
            hiddenDirectory: clone.temporaryRoot,
        });

        try {
            assert.equal(lstatSync(clonedLibmpvPath).isFile(), true);
            assert.equal(
                statSync(clonedLibmpvPath).ino,
                statSync(source.libmpvSonamePath).ino
            );

            guard.hide();

            assert.equal(entryExists(clonedLibmpvPath), false);
            assert.equal(lstatSync(source.libmpvSonamePath).isFile(), true);
            assert.equal(
                readFileSync(source.libmpvSonamePath, 'utf8'),
                'packaged libmpv'
            );

            guard.restore();

            assert.equal(lstatSync(clonedLibmpvPath).isFile(), true);
            assert.equal(
                statSync(clonedLibmpvPath).ino,
                statSync(source.libmpvSonamePath).ino
            );
        } finally {
            guard.restore();
            clone.cleanup();
            temporaryDirectories.delete(clone.temporaryRoot);
        }

        assert.equal(entryExists(source.libmpvSonamePath), true);
    });

    it('hides and restores a cloned symbolic link without dereferencing it', () => {
        const source = createPackageFixture();
        const clone = createDisposablePackagedLinuxApp(source.executablePath);
        temporaryDirectories.add(clone.temporaryRoot);

        const clonedAliasPath = join(clone.nativeDir, 'lib', 'libmpv.so');
        const guard = createPackagedEntryGuard(clonedAliasPath, {
            expectedKind: 'symbolic-link',
            hiddenDirectory: clone.temporaryRoot,
        });

        try {
            guard.hide();
            assert.equal(entryExists(clonedAliasPath), false);
            assert.equal(
                lstatSync(source.libmpvAliasPath).isSymbolicLink(),
                true
            );
            assert.equal(readlinkSync(source.libmpvAliasPath), 'libmpv.so.2');

            guard.restore();
            assert.equal(lstatSync(clonedAliasPath).isSymbolicLink(), true);
            assert.equal(readlinkSync(clonedAliasPath), 'libmpv.so.2');
        } finally {
            guard.restore();
            clone.cleanup();
            temporaryDirectories.delete(clone.temporaryRoot);
        }
    });

    it('hardlinks regular files and preserves modes, symlinks, and the source manifest', () => {
        const source = createPackageFixture();
        const clone = createDisposablePackagedLinuxApp(source.executablePath);
        temporaryDirectories.add(clone.temporaryRoot);

        try {
            assert.notEqual(clone.packageRoot, source.packageRoot);
            assert.equal(
                statSync(clone.executablePath).mode & 0o777,
                statSync(source.executablePath).mode & 0o777
            );

            const clonedPayloadPath = join(
                clone.packageRoot,
                'resources',
                'payload.bin'
            );
            assert.equal(
                statSync(clonedPayloadPath).ino,
                statSync(source.payloadPath).ino
            );
            assert.equal(statSync(clonedPayloadPath).mode & 0o777, 0o640);

            if (process.platform !== 'win32') {
                const clonedLinkPath = join(
                    clone.packageRoot,
                    'resources',
                    'payload-link'
                );
                assert.equal(lstatSync(clonedLinkPath).isSymbolicLink(), true);
                assert.equal(readlinkSync(clonedLinkPath), 'payload.bin');
            }

            const clonedRuntimeManifestPath = join(
                clone.nativeDir,
                'embedded-mpv-runtime.json'
            );
            assert.equal(existsSync(clonedRuntimeManifestPath), true);
            assert.equal(existsSync(source.runtimeManifestPath), true);
        } finally {
            clone.cleanup();
            temporaryDirectories.delete(clone.temporaryRoot);
        }

        assert.equal(existsSync(clone.temporaryRoot), false);
        assert.equal(existsSync(source.runtimeManifestPath), true);
    });

    it('copies a regular file when hardlinking is unavailable', () => {
        const source = createPackageFixture();
        const clone = createDisposablePackagedLinuxApp(source.executablePath, {
            linkFile() {
                throw Object.assign(new Error('cross-device hardlink'), {
                    code: 'EXDEV',
                });
            },
        });
        temporaryDirectories.add(clone.temporaryRoot);

        try {
            assert.equal(statSync(clone.executablePath).mode & 0o777, 0o755);
            const clonedPayloadPath = join(
                clone.packageRoot,
                'resources',
                'payload.bin'
            );
            assert.equal(
                readFileSync(clonedPayloadPath, 'utf8'),
                readFileSync(source.payloadPath, 'utf8')
            );
            assert.notEqual(
                statSync(clonedPayloadPath).ino,
                statSync(source.payloadPath).ino
            );
            assert.equal(statSync(clonedPayloadPath).mode & 0o777, 0o640);
        } finally {
            clone.cleanup();
            temporaryDirectories.delete(clone.temporaryRoot);
        }
    });
});
