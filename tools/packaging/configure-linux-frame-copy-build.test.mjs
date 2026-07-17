import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { configureLinuxFrameCopyBuild } from './configure-linux-frame-copy-build.mjs';

const workspaceRoot = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    '..'
);
const electronBuilderConfig = JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, 'electron-builder.json'), 'utf8')
);
const buildWorkflow = fs.readFileSync(
    path.join(workspaceRoot, '.github', 'workflows', 'build-and-make.yaml'),
    'utf8'
);

function workflowStep(name) {
    const marker = `            - name: ${name}\n`;
    const start = buildWorkflow.indexOf(marker);
    assert.notEqual(start, -1, `Missing workflow step: ${name}`);
    const nextStep = buildWorkflow.indexOf('\n            - name:', start + 1);
    return buildWorkflow.slice(
        start,
        nextStep === -1 ? buildWorkflow.length : nextStep
    );
}

function configuredTargets(config) {
    return config.linux.target.map(({ target, arch }) => ({
        target: target.toLowerCase(),
        arch,
    }));
}

test('configures an x64-only system pass with exact package dependencies', () => {
    const configured = configureLinuxFrameCopyBuild(electronBuilderConfig, {
        profileName: 'system',
    });

    assert.deepEqual(configuredTargets(configured), [
        { target: 'deb', arch: ['x64'] },
        { target: 'rpm', arch: ['x64'] },
        { target: 'pacman', arch: ['x64'] },
    ]);
    assert.deepEqual(configured.deb.fpm, ['--depends=libmpv2']);
    assert.deepEqual(configured.rpm.fpm, ['--depends=mpv-libs']);
    assert.deepEqual(configured.pacman.fpm, ['--depends=mpv']);
});

test('configures portable and flatpak passes without mixing targets', () => {
    const portable = configureLinuxFrameCopyBuild(electronBuilderConfig, {
        profileName: 'portable',
    });
    assert.deepEqual(configuredTargets(portable), [
        { target: 'appimage', arch: ['x64', 'armv7l', 'arm64'] },
        { target: 'snap', arch: ['x64', 'armv7l'] },
    ]);

    const flatpak = configureLinuxFrameCopyBuild(electronBuilderConfig, {
        profileName: 'flatpak',
    });
    assert.deepEqual(configuredTargets(flatpak), [
        { target: 'flatpak', arch: ['x64'] },
    ]);
    assert.deepEqual(portable.snap.plugs, [
        'default',
        {
            'shared-memory': {
                interface: 'shared-memory',
                private: true,
            },
        },
    ]);
});

test('configures a separate marker-only foreign DEB pass without libmpv metadata', () => {
    const configured = configureLinuxFrameCopyBuild(electronBuilderConfig, {
        foreignDeb: true,
    });

    assert.deepEqual(configuredTargets(configured), [
        { target: 'deb', arch: ['armv7l', 'arm64'] },
    ]);
    assert.equal(
        configured.deb.fpm?.some((entry) =>
            entry.includes('--depends=libmpv2')
        ) ?? false,
        false
    );
    assert.equal(
        configured.directories.output,
        'dist/executables-linux-foreign'
    );
});

test('does not mutate the shared electron-builder configuration', () => {
    const before = JSON.stringify(electronBuilderConfig);
    configureLinuxFrameCopyBuild(electronBuilderConfig, {
        profileName: 'system',
    });
    assert.equal(JSON.stringify(electronBuilderConfig), before);
});

test('rejects an unknown profile and conflicting foreign/profile modes', () => {
    assert.throws(
        () =>
            configureLinuxFrameCopyBuild(electronBuilderConfig, {
                profileName: 'standard',
            }),
        /Unsupported Linux frame-copy profile/
    );
    assert.throws(
        () =>
            configureLinuxFrameCopyBuild(electronBuilderConfig, {
                profileName: 'system',
                foreignDeb: true,
            }),
        /must not select a frame-copy profile/
    );
});

test('rejects duplicate profile targets even when target count looks complete', () => {
    const malformed = structuredClone(electronBuilderConfig);
    malformed.linux.target = malformed.linux.target.map((target) =>
        target.target === 'Snap' ? { ...target, target: 'AppImage' } : target
    );
    assert.throws(
        () =>
            configureLinuxFrameCopyBuild(malformed, {
                profileName: 'portable',
            }),
        /duplicate target "appimage".*missing.*snap/is
    );
});

test('preserves unrelated fpm dependencies and normalizes only frame-copy dependencies', () => {
    const customized = structuredClone(electronBuilderConfig);
    customized.deb = {
        fpm: ['--depends=unrelated-runtime', '--depends=libmpv2 >= 2'],
    };
    const system = configureLinuxFrameCopyBuild(customized, {
        profileName: 'system',
    });
    assert.deepEqual(system.deb.fpm, [
        '--depends=unrelated-runtime',
        '--depends=libmpv2',
    ]);

    const foreign = configureLinuxFrameCopyBuild(customized, {
        foreignDeb: true,
    });
    assert.deepEqual(foreign.deb.fpm, ['--depends=unrelated-runtime']);
});

test('Linux CI builds one cached source runtime and packages three isolated profiles', () => {
    assert.match(buildWorkflow, /^ {4}linux-embedded-mpv-runtime:$/m);
    for (const profile of ['system', 'portable', 'flatpak']) {
        assert.match(
            buildWorkflow,
            new RegExp(`linux_profile: ${profile}(?:\\s|$)`)
        );
    }
    assert.doesNotMatch(buildWorkflow, /linux_profile: standard/);
    assert.match(
        buildWorkflow,
        /configure-linux-frame-copy-build\.mjs --profile/
    );
    assert.match(
        buildWorkflow,
        /configure-linux-frame-copy-build\.mjs --foreign-deb/
    );
    assert.match(
        buildWorkflow,
        /apt-cache policy[\s\S]*meson=1\.7\.2[\s\S]*toolchain-sha256/
    );
    assert.match(
        buildWorkflow,
        /key: \$\{\{ steps\.linux-runtime-cache-key\.outputs\.key \}\}/
    );
    const cacheStep = workflowStep(
        'Restore pinned Linux runtime and immutable source inputs'
    );
    assert.match(cacheStep, /dist\/linux-frame-copy-runtime-source-inputs/);
    assert.doesNotMatch(cacheStep, /linux-frame-copy-runtime-sources\.tar\.xz/);
    assert.doesNotMatch(cacheStep, /THIRD_PARTY_NOTICES/);

    const complianceStep = workflowStep(
        'Generate Linux runtime notices and assemble source compliance'
    );
    assert.doesNotMatch(complianceStep, /^\s+if:/m);
    assert.match(
        complianceStep,
        /generate-linux-runtime-notices\.cjs generate/
    );
    assert.match(complianceStep, /git rev-parse HEAD/);
    assert.match(complianceStep, /git diff --binary HEAD/);
    assert.match(
        complianceStep,
        /tar[\s\S]*linux-frame-copy-runtime-sources\.tar\.xz/
    );
    assert.match(complianceStep, /source-index\.json/);
    assert.match(complianceStep, /THIRD_PARTY_NOTICES\.txt/);
    assert.match(complianceStep, /embedded-mpv-notices\.json/);
    assert.match(
        complianceStep,
        /SOURCE_INPUT_ROOT.*license-inputs[\s\S]*SOURCE_BUNDLE_ROOT.*license-inputs/
    );
    assert.match(
        complianceStep,
        /new Set\(expectedArchiveHashes\)\.size[\s\S]*archives\.length !== expectedArchiveHashes\.length/
    );
    assert.match(complianceStep, /prepare-linux-runtime-source-snapshot\.cjs/);
    assert.doesNotMatch(
        complianceStep,
        /cp -a "\$\{SOURCE_INPUT_ROOT\}\/git\/\."/
    );
    assert.ok(
        complianceStep.indexOf('prepare-linux-runtime-source-snapshot.cjs') <
            complianceStep.indexOf(
                '--file dist/compliance/linux-frame-copy-runtime-sources.tar.xz'
            )
    );
    assert.match(
        complianceStep,
        /libplacebo-source-record\.json[\s\S]*sourceGitCommit[\s\S]*sourceSubmodules/
    );
    assert.match(
        complianceStep,
        /prepare-linux-runtime-source-snapshot\.cjs assert-vcs-free/
    );
    assert.ok(
        complianceStep.indexOf(
            'prepare-linux-runtime-source-snapshot.cjs assert-vcs-free'
        ) <
            complianceStep.indexOf(
                '--file dist/compliance/linux-frame-copy-runtime-sources.tar.xz'
            )
    );
    assert.match(
        buildWorkflow,
        /hashFiles\([^\n]*prepare-linux-runtime-source-snapshot\.cjs/
    );

    const buildStep = workflowStep('Build and stage pinned LGPL Linux runtime');
    assert.match(buildStep, /generate-linux-runtime-notices\.cjs collect/);
    assert.match(
        buildStep,
        /linux-frame-copy-runtime-source-inputs[\s\S]*archives[\s\S]*git\/libplacebo/
    );
    assert.ok(
        buildStep.indexOf('git clean -ffdqx') <
            buildStep.indexOf(
                'cp -a "${IPTVNATOR_EMBEDDED_MPV_LINUX_BUILD_ROOT}/sources/libplacebo"'
            )
    );
    assert.doesNotMatch(buildStep, /linux-frame-copy-runtime-sources\.tar\.xz/);
    assert.match(
        buildWorkflow,
        /IPTVNATOR_LINUX_FRAME_COPY_PROFILE: \$\{\{ matrix\.linux_profile/
    );
    const makeStep = workflowStep('Make Electron app');
    assert.match(
        makeStep,
        /IPTVNATOR_LINUX_FRAME_COPY_PROFILE: \$\{\{ matrix\.linux_profile/
    );
    assert.match(buildWorkflow, /linux-frame-copy-runtime-sources\.tar\.xz/);
    assert.match(buildWorkflow, /name: linux-frame-copy-runtime-sources/);
    assert.match(buildWorkflow, /sourceSha256[\s\S]*source-index\.json/);
});

test('Linux runtime toolchain installs fontconfig generators without network wraps', () => {
    const cacheKeyStep = workflowStep(
        'Resolve Linux runtime toolchain cache key'
    );
    const installStep = workflowStep(
        'Install pinned Linux runtime build dependencies'
    );

    assert.match(cacheKeyStep, /\bapt-cache policy[\s\S]*\bgperf\b/);
    assert.match(installStep, /^\s+gperf\s+\\$/m);
});

test('Linux CI verifies every package family and exercises intended environments', () => {
    for (const suffix of [
        'AppImage',
        'deb',
        'rpm',
        'pacman',
        'snap',
        'flatpak',
    ]) {
        assert.match(
            buildWorkflow,
            new RegExp(`\\.${suffix.replace('.', '\\.')}(?:['"*:/\\s]|$)`)
        );
    }
    assert.ok(
        buildWorkflow.match(/verify-linux-frame-copy-runtime\.mjs/g).length >= 6
    );
    assert.match(buildWorkflow, /ubuntu:24\.04/);
    assert.match(buildWorkflow, /fedora:latest/);
    assert.match(buildWorkflow, /archlinux:latest/);
    assert.match(buildWorkflow, /snap run --shell iptvnator/);
    assert.match(
        buildWorkflow,
        /flatpak run --command=sh com\.fourgray\.iptvnator/
    );
    assert.doesNotMatch(buildWorkflow, /\bldd\b/);
});

test('dedicated packaged x64 smoke cannot silently skip', () => {
    const linuxDependencies = workflowStep('Install Linux system dependencies');
    assert.match(linuxDependencies, /--no-install-recommends/);
    assert.match(linuxDependencies, /^\s+xauth\s*\\?$/m);
    assert.match(linuxDependencies, /^\s+xvfb\s*\\?$/m);
    const packagedSmoke = workflowStep(
        'Run packaged x64 frame-copy and fallback smoke'
    );
    assert.match(
        packagedSmoke,
        /IPTVNATOR_E2E_REQUIRE_PACKAGED_FRAME_COPY: '1'/
    );
    assert.match(
        packagedSmoke,
        /IPTVNATOR_E2E_PACKAGED_EXECUTABLE: \$\{\{ github\.workspace \}\}\/dist\/executables\/linux-unpacked\/iptvnator/
    );
    assert.match(
        packagedSmoke,
        /electron-backend-e2e:packaged-frame-copy-smoke/
    );
    const hardwareDiagnostic = workflowStep(
        'Diagnose packaged x64 frame-copy hardware path'
    );
    assert.match(hardwareDiagnostic, /continue-on-error: true/);
    assert.match(hardwareDiagnostic, /\/dev\/dri\/renderD128/);
    assert.match(
        hardwareDiagnostic,
        /IPTVNATOR_E2E_REQUIRE_PACKAGED_FRAME_COPY: '1'/
    );
    assert.doesNotMatch(hardwareDiagnostic, /LIBGL_ALWAYS_SOFTWARE/);
});

test('draft release consumes split Linux artifacts and source compliance', () => {
    for (const artifactName of [
        'linux-system-artifacts',
        'linux-portable-artifacts',
        'linux-flatpak-artifacts',
        'linux-frame-copy-runtime-sources',
    ]) {
        assert.match(buildWorkflow, new RegExp(artifactName));
    }
    const systemUpload = workflowStep('Upload system-runtime Linux artifacts');
    for (const artifactGlob of [
        'dist/executables/*.deb',
        'dist/executables/*.rpm',
        'dist/executables/*.pacman',
        'dist/executables/*.pkg.tar.*',
    ]) {
        assert.ok(systemUpload.includes(artifactGlob));
    }
    const portableUpload = workflowStep(
        'Upload portable-runtime Linux artifacts'
    );
    for (const artifactGlob of [
        'dist/executables/*.AppImage',
        'dist/executables/*.snap',
        'dist/executables/**/latest-linux*.yml',
        'dist/executables/**/*.blockmap',
    ]) {
        assert.ok(portableUpload.includes(artifactGlob));
    }
    assert.ok(
        workflowStep('Upload Flatpak-runtime Linux artifacts').includes(
            'dist/executables/**/*.flatpak'
        )
    );
    const release = workflowStep('Create Draft Release');
    for (const releasePath of [
        'artifacts/linux-system-artifacts/*.deb',
        'artifacts/linux-system-artifacts/*.rpm',
        'artifacts/linux-system-artifacts/*.pacman',
        'artifacts/linux-system-artifacts/*.pkg.tar.*',
        'artifacts/linux-portable-artifacts/*.AppImage',
        'artifacts/linux-portable-artifacts/*.snap',
        'artifacts/linux-flatpak-artifacts/*.flatpak',
        'artifacts/linux-frame-copy-runtime-sources/linux-frame-copy-runtime-sources.tar.xz',
    ]) {
        assert.ok(release.includes(releasePath));
    }
    assert.doesNotMatch(buildWorkflow, /^ {4}publish-snap:/m);
});
