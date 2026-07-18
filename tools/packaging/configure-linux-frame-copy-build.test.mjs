import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

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
const buildWorkflowConfig = parseYaml(buildWorkflow);

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
    assert.deepEqual(configured.deb.fpm, [
        '--depends=libmpv2',
        '--depends=libegl1',
        '--depends=libgl1',
        '--depends=libgbm1',
    ]);
    assert.deepEqual(configured.rpm.fpm, [
        '--depends=mpv-libs',
        '--depends=libglvnd-egl',
        '--depends=libglvnd-glx',
        '--depends=mesa-libgbm',
    ]);
    assert.deepEqual(configured.pacman.fpm, [
        '--depends=mpv',
        '--depends=libglvnd',
        '--depends=mesa',
    ]);
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
    assert.equal(portable.snap.base, 'core22');
    assert.equal(portable.snap.confinement, 'strict');
    assert.deepEqual(portable.snap.layout, {
        '/usr/share/libdrm': {
            bind: '$SNAP/graphics/libdrm',
        },
        '/usr/share/drirc.d': {
            symlink: '$SNAP/graphics/drirc.d',
        },
    });
    assert.deepEqual(portable.snap.plugs, [
        'default',
        {
            'graphics-core22': {
                interface: 'content',
                target: '$SNAP/graphics',
                'default-provider': 'mesa-core22',
            },
        },
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

test('configures exactly one requested marker-only foreign DEB architecture', () => {
    for (const foreignArch of ['armv7l', 'arm64']) {
        const configured = configureLinuxFrameCopyBuild(electronBuilderConfig, {
            foreignDeb: true,
            foreignArch,
        });

        assert.deepEqual(configuredTargets(configured), [
            { target: 'deb', arch: [foreignArch] },
        ]);
    }
});

test('CLI writes an exact marker-only foreign DEB architecture', (t) => {
    const temporaryDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-build-config-')
    );
    t.after(() =>
        fs.rmSync(temporaryDirectory, { recursive: true, force: true })
    );
    const configPath = path.join(temporaryDirectory, 'electron-builder.json');
    fs.writeFileSync(
        configPath,
        `${JSON.stringify(electronBuilderConfig, null, 4)}\n`
    );

    const result = spawnSync(
        process.execPath,
        [
            path.join(
                workspaceRoot,
                'tools',
                'packaging',
                'configure-linux-frame-copy-build.mjs'
            ),
            '--config',
            configPath,
            '--foreign-deb',
            '--foreign-arch',
            'arm64',
        ],
        { encoding: 'utf8' }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
        configuredTargets(JSON.parse(fs.readFileSync(configPath, 'utf8'))),
        [{ target: 'deb', arch: ['arm64'] }]
    );

    const missingValue = spawnSync(
        process.execPath,
        [
            path.join(
                workspaceRoot,
                'tools',
                'packaging',
                'configure-linux-frame-copy-build.mjs'
            ),
            '--config',
            configPath,
            '--foreign-deb',
            '--foreign-arch',
        ],
        { encoding: 'utf8' }
    );
    assert.notEqual(missingValue.status, 0);
    assert.match(missingValue.stderr, /--foreign-arch requires a value/);
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
    assert.throws(
        () =>
            configureLinuxFrameCopyBuild(electronBuilderConfig, {
                foreignArch: 'arm64',
            }),
        /foreign architecture requires --foreign-deb/
    );
    assert.throws(
        () =>
            configureLinuxFrameCopyBuild(electronBuilderConfig, {
                foreignDeb: true,
                foreignArch: 'x64',
            }),
        /Unsupported marker-only foreign DEB architecture/
    );
    for (const foreignArch of ['', 64]) {
        assert.throws(
            () =>
                configureLinuxFrameCopyBuild(electronBuilderConfig, {
                    foreignDeb: true,
                    foreignArch,
                }),
            /Unsupported marker-only foreign DEB architecture/
        );
    }
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
        fpm: [
            '--depends=unrelated-runtime',
            '--depends=mesa',
            '--depends=libmpv2 >= 2',
            '--depends=libgl1',
        ],
    };
    const system = configureLinuxFrameCopyBuild(customized, {
        profileName: 'system',
    });
    assert.deepEqual(system.deb.fpm, [
        '--depends=unrelated-runtime',
        '--depends=mesa',
        '--depends=libmpv2',
        '--depends=libegl1',
        '--depends=libgl1',
        '--depends=libgbm1',
    ]);

    const foreign = configureLinuxFrameCopyBuild(customized, {
        foreignDeb: true,
    });
    assert.deepEqual(foreign.deb.fpm, [
        '--depends=unrelated-runtime',
        '--depends=mesa',
    ]);
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
        /configure-linux-frame-copy-build\.mjs[\s\S]*--foreign-deb/
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

test('keeps non-Linux builds independent from the Linux runtime prerequisite', () => {
    const crossPlatformJob = buildWorkflowConfig.jobs?.['build-cross-platform'];
    const linuxJob = buildWorkflowConfig.jobs?.['build-linux'];

    assert.ok(crossPlatformJob);
    assert.ok(linuxJob);
    assert.equal(crossPlatformJob.needs, undefined);
    assert.deepEqual(
        crossPlatformJob.strategy.matrix.include.map(({ os, arch }) => ({
            os,
            arch,
        })),
        [
            { os: 'macos', arch: 'x64' },
            { os: 'macos', arch: 'arm64' },
            { os: 'windows', arch: 'x64' },
        ]
    );
    assert.equal(crossPlatformJob.strategy['fail-fast'], false);
    assert.equal(linuxJob.needs, 'linux-embedded-mpv-runtime');
    assert.deepEqual(
        linuxJob.strategy.matrix.include.map(
            ({ os, arch, linux_profile: profile }) => ({
                os,
                arch,
                profile,
            })
        ),
        [
            { os: 'linux', arch: 'x64', profile: 'system' },
            { os: 'linux', arch: 'x64', profile: 'portable' },
            { os: 'linux', arch: 'x64', profile: 'flatpak' },
        ]
    );
    assert.equal(
        linuxJob.name,
        'Build on ${{ matrix.os }} ${{ matrix.arch }} (${{ matrix.linux_profile }})'
    );
    assert.equal(linuxJob.strategy['fail-fast'], false);
    assert.deepEqual(linuxJob.steps, crossPlatformJob.steps);
    assert.deepEqual(buildWorkflowConfig.jobs['create-release'].needs, [
        'build-cross-platform',
        'build-linux',
    ]);
    assert.match(buildWorkflow, /steps:\s+&electron-build-steps/);
    assert.match(buildWorkflow, /steps:\s+\*electron-build-steps/);
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
    const flatpakVerificationStep = workflowStep(
        'Verify Flatpak payload, launcher, and sandboxed runtime'
    );

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
    assert.match(
        buildWorkflow,
        /snap run iptvnator --embedded-mpv-runtime-probe/
    );
    assert.doesNotMatch(buildWorkflow, /snap run --shell iptvnator/);
    assert.match(
        buildWorkflow,
        /flatpak run --command=sh com\.fourgray\.iptvnator/
    );
    assert.match(
        flatpakVerificationStep,
        /flatpak run\s+\\\s+--env=LIBGL_ALWAYS_SOFTWARE=1\s+\\\s+com\.fourgray\.iptvnator\s+\\\s+--embedded-mpv-runtime-probe/
    );
    assert.doesNotMatch(
        flatpakVerificationStep,
        /HELPER_PATH=.*iptvnator_mpv_helper/
    );
    assert.doesNotMatch(buildWorkflow, /\bldd\b/);
});

test('Flatpak application runtime probe runs under an isolated D-Bus session', () => {
    const installStep = workflowStep('Install Linux system dependencies');
    const flatpakVerificationStep = workflowStep(
        'Verify Flatpak payload, launcher, and sandboxed runtime'
    );

    assert.match(
        flatpakVerificationStep,
        /xvfb-run -a dbus-run-session -- flatpak run\s+\\\s+--env=LIBGL_ALWAYS_SOFTWARE=1\s+\\\s+com\.fourgray\.iptvnator\s+\\\s+--embedded-mpv-runtime-probe/
    );
    assert.match(installStep, /^\s+dbus-daemon\s+\\$/m);
    assert.match(
        flatpakVerificationStep,
        /xvfb-run -a env LIBGL_ALWAYS_SOFTWARE=1\s+\\\s+flatpak run --command=sh com\.fourgray\.iptvnator/
    );
});

test('foreign DEB CI explicitly selects both marker-only ARM architectures', () => {
    const foreignDebStep = workflowStep(
        'Make marker-only foreign-architecture DEB packages'
    );

    assert.match(foreignDebStep, /for foreign_arch in armv7l arm64; do/);
    assert.match(
        foreignDebStep,
        /--foreign-deb\s+\\\s+--foreign-arch "\$\{foreign_arch\}"/
    );
    assert.match(foreignDebStep, /--arch="\$\{foreign_arch\}"/);
    assert.match(
        foreignDebStep,
        /for foreign_arch[\s\S]*cp "\$\{RUNNER_TEMP\}\/electron-builder\.base\.json" electron-builder\.json[\s\S]*configure-linux-frame-copy-build\.mjs/
    );
    assert.match(foreignDebStep, /rm -rf dist\/executables-linux-foreign/);
    assert.match(
        foreignDebStep,
        /mapfile -t foreign_debs < <\(\s*find dist\/executables-linux-foreign[\s\S]*-name '\*\.deb' -print\s*\)/
    );
    assert.match(foreignDebStep, /test "\$\{#foreign_debs\[@\]\}" -eq 1/);
    assert.match(foreignDebStep, /armv7l\) expected_deb_arch=armhf/);
    assert.match(foreignDebStep, /arm64\) expected_deb_arch=arm64/);
    assert.match(
        foreignDebStep,
        /actual_deb_arch="\$\(dpkg-deb --field "\$\{foreign_debs\[0\]\}" Architecture\)"[\s\S]*test "\$\{actual_deb_arch\}" = "\$\{expected_deb_arch\}"/
    );
    assert.match(
        foreignDebStep,
        /mv "\$\{foreign_debs\[0\]\}" dist\/executables\//
    );
    assert.match(foreignDebStep, /IPTVNATOR_LINUX_FRAME_COPY_PROFILE: ''/);
    assert.match(foreignDebStep, /IPTVNATOR_REQUIRE_EMBEDDED_MPV: '1'/);
    assert.doesNotMatch(foreignDebStep, /IPTVNATOR_REQUIRE_EMBEDDED_MPV: '0'/);
});

test('system package smoke environments install every direct helper runtime dependency', () => {
    const debStep = workflowStep('Verify DEB payloads and x64 system runtime');
    for (const dependency of ['libmpv2', 'libegl1', 'libgl1', 'libgbm1']) {
        assert.match(debStep, new RegExp(`\\b${dependency}\\b`));
    }

    const rpmStep = workflowStep('Verify RPM payload and x64 system runtime');
    for (const dependency of [
        'mpv-libs',
        'libglvnd-egl',
        'libglvnd-glx',
        'mesa-libgbm',
    ]) {
        assert.match(rpmStep, new RegExp(`\\b${dependency}\\b`));
    }

    const pacmanStep = workflowStep(
        'Verify Pacman payload and x64 system runtime'
    );
    for (const dependency of ['mpv', 'libglvnd', 'mesa']) {
        assert.match(pacmanStep, new RegExp(`\\b${dependency}\\b`));
    }
});

test('Snap verifier preserves fail-closed status while exposing captured diagnostics', () => {
    const snapStep = workflowStep(
        'Verify Snap payloads and strict-confinement runtime'
    );

    assert.match(snapStep, /set -euo pipefail/);
    assert.match(snapStep, /2>&1 \| tee \/dev\/stderr/);
    assert.doesNotMatch(
        snapStep,
        /^\s+printf '%s\\n' "\$\{verification\}"\s*$/m
    );
    assert.ok(
        snapStep.indexOf('verification="$(') <
            snapStep.indexOf("grep -Fq 'Verified snap x64 Linux'")
    );
    assert.ok(
        snapStep.indexOf("grep -Fq 'Verified snap x64 Linux'") <
            snapStep.indexOf('sudo snap install --dangerous')
    );
    assert.match(
        snapStep,
        /snap list mesa-core22 >\/dev\/null 2>&1 \|\| sudo snap install mesa-core22/
    );
    assert.match(
        snapStep,
        /snap list gnome-3-28-1804 >\/dev\/null 2>&1 \|\| sudo snap install gnome-3-28-1804/
    );
    assert.ok(
        snapStep.indexOf('sudo snap install mesa-core22') <
            snapStep.indexOf('sudo snap install --dangerous')
    );
    assert.ok(
        snapStep.indexOf('sudo snap install gnome-3-28-1804') <
            snapStep.indexOf('sudo snap install --dangerous')
    );
    assert.ok(
        snapStep.indexOf('sudo snap install --dangerous') <
            snapStep.indexOf('installed_x64=true')
    );
    assert.match(
        snapStep,
        /sudo snap connect iptvnator:graphics-core22 mesa-core22:graphics-core22/
    );
    assert.match(
        snapStep,
        /sudo snap connect iptvnator:gnome-3-28-1804 gnome-3-28-1804:gnome-3-28-1804/
    );
    assert.match(
        snapStep,
        /\$2 == "iptvnator:graphics-core22" && \$3 == "mesa-core22:graphics-core22"/
    );
    assert.match(
        snapStep,
        /\$2 == "iptvnator:gnome-3-28-1804" && \$3 == "gnome-3-28-1804:gnome-3-28-1804"/
    );
    assert.match(
        snapStep,
        /\$1 == "shared-memory" && \$2 == "iptvnator:shared-memory" && \$3 == ":shared-memory"/
    );
    assert.match(
        snapStep,
        /sudo snap disconnect iptvnator:graphics-core22 mesa-core22:graphics-core22/
    );
    assert.match(
        snapStep,
        /\$2 == "iptvnator:graphics-core22" && \$3 == "-" \{ found=1 \} END \{ exit !found \}/
    );
    assert.match(snapStep, /disconnected_probe="\$\(/);
    assert.match(snapStep, /disconnected_status=\$\?/);
    assert.match(snapStep, /test "\$\{disconnected_status\}" -eq 1/);
    assert.ok(
        snapStep.includes(
            `grep -Fx '{"usable":false,"reason":"snap-graphics-provider-unavailable"}'`
        )
    );
    const firstGraphicsConnect = snapStep.indexOf(
        'sudo snap connect iptvnator:graphics-core22'
    );
    const graphicsDisconnect = snapStep.indexOf(
        'sudo snap disconnect iptvnator:graphics-core22'
    );
    const secondGraphicsConnect = snapStep.indexOf(
        'sudo snap connect iptvnator:graphics-core22',
        firstGraphicsConnect + 1
    );
    assert.ok(firstGraphicsConnect < graphicsDisconnect);
    assert.ok(graphicsDisconnect < snapStep.indexOf('disconnected_probe="$('));
    assert.ok(
        snapStep.indexOf('test "${disconnected_status}" -eq 1') <
            secondGraphicsConnect
    );
    const firstRuntimeProbe = snapStep.indexOf(
        'snap run iptvnator --embedded-mpv-runtime-probe'
    );
    const successfulRuntimeProbe = snapStep.lastIndexOf(
        'snap run iptvnator --embedded-mpv-runtime-probe'
    );
    const graphicsConnectionAssertion = snapStep.indexOf(
        '$2 == "iptvnator:graphics-core22" && $3 == "mesa-core22:graphics-core22"'
    );
    const gnomeConnectionAssertion = snapStep.indexOf(
        '$2 == "iptvnator:gnome-3-28-1804" && $3 == "gnome-3-28-1804:gnome-3-28-1804"'
    );
    const sharedMemoryConnectionAssertion = snapStep.indexOf(
        '$1 == "shared-memory" && $2 == "iptvnator:shared-memory" && $3 == ":shared-memory"'
    );
    assert.ok(firstRuntimeProbe < secondGraphicsConnect);
    assert.ok(firstRuntimeProbe < successfulRuntimeProbe);
    assert.ok(secondGraphicsConnect < successfulRuntimeProbe);
    assert.ok(secondGraphicsConnect < graphicsConnectionAssertion);
    assert.ok(graphicsConnectionAssertion < gnomeConnectionAssertion);
    assert.ok(gnomeConnectionAssertion < sharedMemoryConnectionAssertion);
    assert.ok(sharedMemoryConnectionAssertion < successfulRuntimeProbe);
    assert.match(snapStep, /snap run iptvnator --embedded-mpv-runtime-probe/);
    for (const hostileOverride of [
        '__EGL_VENDOR_LIBRARY_FILENAMES',
        'GBM_BACKEND',
        'MESA_LOADER_DRIVER_OVERRIDE',
        'LIBVA_DRIVER_NAME',
        'VDPAU_DRIVER_PATH',
        'VK_DRIVER_FILES',
        'VK_ICD_FILENAMES',
        'VK_ADD_DRIVER_FILES',
        'VK_ADD_LAYER_PATH',
        'VK_IMPLICIT_LAYER_PATH',
        'VK_ADD_IMPLICIT_LAYER_PATH',
        'XDG_CONFIG_HOME',
        'XDG_CONFIG_DIRS',
        'XDG_DATA_HOME',
        'XDG_DATA_DIRS',
    ]) {
        assert.match(
            snapStep.slice(secondGraphicsConnect),
            new RegExp(`${hostileOverride}=/tmp/hostile`)
        );
    }
    assert.doesNotMatch(snapStep, /snap run --shell/);
    assert.doesNotMatch(snapStep, /iptvnator_mpv_helper/);
    assert.doesNotMatch(snapStep, /LD_LIBRARY_PATH/);
});

test('dedicated packaged x64 smoke cannot silently skip', () => {
    const linuxDependencies = workflowStep('Install Linux system dependencies');
    assert.match(linuxDependencies, /--no-install-recommends/);
    assert.match(linuxDependencies, /^\s+libgl-dev\s*\\?$/m);
    assert.doesNotMatch(linuxDependencies, /\blibopengl-dev\b/);
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
