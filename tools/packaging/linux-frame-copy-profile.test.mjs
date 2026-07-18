import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { configureLinuxFrameCopyBuild } from './configure-linux-frame-copy-build.mjs';

const currentDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
    LINUX_FRAME_COPY_PROFILES,
    LINUX_SYSTEM_PACKAGE_DEPENDENCIES,
    resolveLinuxFrameCopyProfile,
    validateLinuxProfileTargets,
} = require('./linux-frame-copy-profile.cjs');
const electronBuilderConfig = JSON.parse(
    fs.readFileSync(
        join(currentDir, '..', '..', 'electron-builder.json'),
        'utf8'
    )
);

function hasSystemFrameCopyDependency(config, format, dependency) {
    return (config[format]?.fpm ?? []).some((option) =>
        new RegExp(`^--depends(?:=|\\s+)${dependency}(?:$|\\s|[<>=])`).test(
            option
        )
    );
}

test('defines the exact immutable Linux frame-copy profile matrix', () => {
    assert.deepEqual(LINUX_FRAME_COPY_PROFILES, {
        system: {
            name: 'system',
            runtimeMode: 'system',
            targets: ['deb', 'rpm', 'pacman'],
            manifestOrigin: 'system-libmpv-frame-copy',
        },
        portable: {
            name: 'portable',
            runtimeMode: 'bundled',
            targets: ['appimage', 'snap'],
            manifestOrigin: 'bundled-lgpl-frame-copy',
        },
        flatpak: {
            name: 'flatpak',
            runtimeMode: 'bundled',
            targets: ['flatpak'],
            manifestOrigin: 'bundled-lgpl-frame-copy',
        },
    });
    assert.equal(Object.isFrozen(LINUX_FRAME_COPY_PROFILES), true);
    for (const profile of Object.values(LINUX_FRAME_COPY_PROFILES)) {
        assert.equal(Object.isFrozen(profile), true);
        assert.equal(Object.isFrozen(profile.targets), true);
    }
});

test('defines immutable system-package helper runtime dependencies', () => {
    assert.deepEqual(LINUX_SYSTEM_PACKAGE_DEPENDENCIES, {
        deb: ['libmpv2', 'libegl1', 'libgl1', 'libgbm1'],
        rpm: ['mpv-libs', 'libglvnd-egl', 'libglvnd-glx', 'mesa-libgbm'],
        pacman: ['mpv', 'libglvnd', 'mesa'],
    });
    assert.equal(Object.isFrozen(LINUX_SYSTEM_PACKAGE_DEPENDENCIES), true);
    for (const dependencies of Object.values(
        LINUX_SYSTEM_PACKAGE_DEPENDENCIES
    )) {
        assert.equal(Object.isFrozen(dependencies), true);
    }
});

test('resolves each supported profile as an immutable defensive value', () => {
    const firstSystemProfile = resolveLinuxFrameCopyProfile('system');
    const secondSystemProfile = resolveLinuxFrameCopyProfile('system');

    assert.deepEqual(firstSystemProfile, {
        name: 'system',
        runtimeMode: 'system',
        targets: ['deb', 'rpm', 'pacman'],
        manifestOrigin: 'system-libmpv-frame-copy',
    });
    assert.deepEqual(resolveLinuxFrameCopyProfile('portable'), {
        name: 'portable',
        runtimeMode: 'bundled',
        targets: ['appimage', 'snap'],
        manifestOrigin: 'bundled-lgpl-frame-copy',
    });
    assert.deepEqual(resolveLinuxFrameCopyProfile('flatpak'), {
        name: 'flatpak',
        runtimeMode: 'bundled',
        targets: ['flatpak'],
        manifestOrigin: 'bundled-lgpl-frame-copy',
    });
    assert.notEqual(firstSystemProfile, LINUX_FRAME_COPY_PROFILES.system);
    assert.notEqual(firstSystemProfile, secondSystemProfile);
    assert.notEqual(
        firstSystemProfile.targets,
        LINUX_FRAME_COPY_PROFILES.system.targets
    );
    assert.notEqual(firstSystemProfile.targets, secondSystemProfile.targets);
    assert.equal(Object.isFrozen(firstSystemProfile), true);
    assert.equal(Object.isFrozen(firstSystemProfile.targets), true);
    assert.throws(() => firstSystemProfile.targets.push('appimage'), TypeError);
    assert.deepEqual(resolveLinuxFrameCopyProfile('system').targets, [
        'deb',
        'rpm',
        'pacman',
    ]);
});

test('rejects missing and unsupported profile names with clear errors', () => {
    for (const value of [undefined, null, '', '   ']) {
        assert.throws(
            () => resolveLinuxFrameCopyProfile(value),
            /Linux frame-copy profile is required/
        );
    }
    assert.throws(
        () => resolveLinuxFrameCopyProfile('standard'),
        /Unsupported Linux frame-copy profile "standard"/
    );
});

test('rejects inherited object property names as unsupported profiles', () => {
    for (const value of ['constructor', 'toString', '__proto__']) {
        const unsupportedProfileError = new RegExp(
            `Unsupported Linux frame-copy profile "${value}"`
        );

        assert.throws(
            () => resolveLinuxFrameCopyProfile(value),
            unsupportedProfileError
        );
        assert.throws(
            () => validateLinuxProfileTargets(value, ['deb']),
            unsupportedProfileError
        );
    }
});

test('validates profile targets case-insensitively with deterministic errors', () => {
    const targets = ['DEB', 'AppImage', 'RPM'];

    assert.deepEqual(validateLinuxProfileTargets('system', targets), [
        'Linux frame-copy profile "system" cannot build target "appimage".',
    ]);
    assert.deepEqual(targets, ['DEB', 'AppImage', 'RPM']);
    assert.deepEqual(
        validateLinuxProfileTargets('portable', ['APPIMAGE', 'sNaP']),
        []
    );
    assert.deepEqual(validateLinuxProfileTargets('flatpak', ['FlatPak']), []);
});

test('rejects a non-array profile target list', () => {
    assert.throws(
        () => validateLinuxProfileTargets('system', 'deb'),
        /Linux frame-copy targets must be an array/
    );
});

test('keeps frame-copy package dependencies out of the base Electron Builder config', () => {
    for (const [target, dependencies] of Object.entries(
        LINUX_SYSTEM_PACKAGE_DEPENDENCIES
    )) {
        assert.equal(
            electronBuilderConfig[target]?.depends,
            undefined,
            `${target}.depends must remain unset so electron-builder keeps its defaults`
        );
        for (const dependency of dependencies) {
            assert.equal(
                hasSystemFrameCopyDependency(
                    electronBuilderConfig,
                    target,
                    dependency
                ),
                false
            );
        }
    }
});

test('keeps frame-copy package dependencies out of non-system passes', () => {
    const configs = [
        configureLinuxFrameCopyBuild(electronBuilderConfig, {
            profileName: 'portable',
        }),
        configureLinuxFrameCopyBuild(electronBuilderConfig, {
            profileName: 'flatpak',
        }),
        configureLinuxFrameCopyBuild(electronBuilderConfig, {
            foreignDeb: true,
        }),
    ];

    for (const config of configs) {
        for (const [format, dependencies] of Object.entries(
            LINUX_SYSTEM_PACKAGE_DEPENDENCIES
        )) {
            for (const dependency of dependencies) {
                assert.equal(
                    hasSystemFrameCopyDependency(config, format, dependency),
                    false
                );
            }
        }
    }
});
