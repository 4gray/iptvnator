import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    createRuntimeProbeEnvironment,
    detectLinuxArtifactFormat,
    extractLinuxArtifact,
    findAppImageSquashfsOffsets,
    findExtractedResourceDir,
    parseVerifierArguments,
    readLinuxArtifactMetadata,
    readElfArchitecture,
    validateSystemPackageDependencies,
    validateExtractedSnapMetadata,
    verifyExtractedLinuxFrameCopyRuntime,
    verifyLinuxFrameCopyArtifact,
} from './verify-linux-frame-copy-runtime.mjs';

const runtimeProbeContractUrl = new URL(
    '../embedded-mpv/runtime-probe-contract.cjs',
    import.meta.url
);
const runtimeProbeContractTypesUrl = new URL(
    '../embedded-mpv/runtime-probe-contract.d.cts',
    import.meta.url
);
const verifierUrl = new URL(
    './verify-linux-frame-copy-runtime.mjs',
    import.meta.url
);
const backendRuntimeContractsUrl = new URL(
    '../../apps/electron-backend/src/app/services/embedded-mpv-frame-copy-runtime/contracts.ts',
    import.meta.url
);
const electronBackendProjectUrl = new URL(
    '../../apps/electron-backend/project.json',
    import.meta.url
);
const SYSTEM_TARGETS = ['deb', 'pacman', 'rpm'];
const SYSTEM_MANIFEST = {
    schemaVersion: 1,
    origin: 'system-libmpv-frame-copy',
    generatedAt: '2026-07-17T00:00:00.000Z',
    platform: 'linux',
    arch: 'x64',
    profile: 'system',
    runtimeMode: 'system',
    targets: SYSTEM_TARGETS,
    artifacts: {
        addon: {
            name: 'embedded_mpv.node',
            regularFile: true,
            readable: true,
        },
        frameReader: {
            name: 'embedded_mpv_frame_reader.node',
            regularFile: true,
            readable: true,
        },
        helper: {
            name: 'iptvnator_mpv_helper',
            regularFile: true,
            readable: true,
            executable: true,
        },
    },
    processIsolation: {
        addonLoadsLibmpv: false,
        readerLoadsLibmpv: false,
        electronLoadsLibmpv: false,
        helperLinksLibmpv: true,
        helperRunpath: ['$ORIGIN/lib'],
    },
    nativeViewFallback: 'process-isolated mpv --wid',
    libmpvSoname: 'libmpv.so.2',
    packageDependencies: {
        deb: ['libmpv2', 'libegl1', 'libopengl0', 'libgbm1'],
        rpm: ['mpv-libs', 'libglvnd-egl', 'libglvnd-opengl', 'mesa-libgbm'],
        pacman: ['mpv', 'libglvnd', 'mesa'],
    },
    runtimeFiles: [],
    runtimeTotalBytes: 0,
};
const DEB_SYSTEM_PACKAGE_DEPENDENCIES = [
    'libmpv2',
    'libegl1',
    'libopengl0',
    'libgbm1',
];

test('uses the shared frozen 3000 ms runtime probe timeout contract', async () => {
    assert.equal(
        fs.existsSync(runtimeProbeContractUrl),
        true,
        'the shared runtime probe contract must exist'
    );
    assert.equal(
        fs.existsSync(runtimeProbeContractTypesUrl),
        true,
        'the shared runtime probe contract types must exist'
    );

    const { default: runtimeProbeContract } = await import(
        runtimeProbeContractUrl.href
    );
    assert.equal(Object.isFrozen(runtimeProbeContract), true);
    assert.equal(runtimeProbeContract.RUNTIME_PROBE_TIMEOUT_MS, 3000);
    assert.match(
        fs.readFileSync(runtimeProbeContractTypesUrl, 'utf8'),
        /readonly RUNTIME_PROBE_TIMEOUT_MS: 3000/
    );

    const verifierSource = fs.readFileSync(verifierUrl, 'utf8');
    assert.match(
        verifierSource,
        /require\(['"]\.\.\/embedded-mpv\/runtime-probe-contract\.cjs['"]\)/
    );
    assert.doesNotMatch(
        verifierSource,
        /const RUNTIME_PROBE_TIMEOUT_MS\s*=\s*3000/
    );

    const backendContractsSource = fs.readFileSync(
        backendRuntimeContractsUrl,
        'utf8'
    );
    assert.match(
        backendContractsSource,
        /import runtimeProbeContract = require\(['"][^'"]*\/runtime-probe-contract\.cjs['"]\)/
    );
    assert.match(
        backendContractsSource,
        /export const \{ RUNTIME_PROBE_TIMEOUT_MS \} = runtimeProbeContract/
    );
    assert.doesNotMatch(
        backendContractsSource,
        /RUNTIME_PROBE_TIMEOUT_MS\s*=\s*3000/
    );
});

test('tracks the shared probe contract in cached backend targets and runtime lint', () => {
    const backendProject = JSON.parse(
        fs.readFileSync(electronBackendProjectUrl, 'utf8')
    );
    const contractInputs = [
        '{workspaceRoot}/tools/embedded-mpv/runtime-probe-contract.cjs',
        '{workspaceRoot}/tools/embedded-mpv/runtime-probe-contract.d.cts',
    ];

    for (const targetName of ['build', 'build-e2e', 'test', 'lint']) {
        const inputs = backendProject.targets[targetName]?.inputs ?? [];
        for (const contractInput of contractInputs) {
            assert.ok(
                inputs.includes(contractInput),
                `${targetName} must track ${contractInput}`
            );
        }
    }

    assert.match(
        backendProject.targets.lint.command,
        /embedded-mpv-frame-copy-runtime\.ts/
    );
    assert.match(
        backendProject.targets.lint.command,
        /embedded-mpv-frame-copy-runtime\/\*\*\/\*\.ts/
    );
});

function elfHeader(architecture) {
    const machines = {
        x64: 62,
        arm64: 183,
        armv7l: 40,
    };
    const image = Buffer.alloc(64);
    image.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
    image.writeUInt16LE(machines[architecture], 18);
    return image;
}

function createSystemPayload({ architecture = 'x64' } = {}) {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-layout-')
    );
    const appDir = path.join(root, 'opt', 'IPTVnator');
    const resourceDir = path.join(appDir, 'resources');
    const nativeDir = path.join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    fs.mkdirSync(nativeDir, { recursive: true });
    fs.writeFileSync(
        path.join(appDir, 'iptvnator.bin'),
        elfHeader(architecture)
    );

    if (architecture === 'x64') {
        fs.writeFileSync(path.join(nativeDir, 'embedded_mpv.node'), 'addon', {
            mode: 0o644,
        });
        fs.writeFileSync(
            path.join(nativeDir, 'embedded_mpv_frame_reader.node'),
            'reader',
            { mode: 0o644 }
        );
        fs.writeFileSync(
            path.join(nativeDir, 'iptvnator_mpv_helper'),
            'helper',
            { mode: 0o755 }
        );
        fs.writeFileSync(
            path.join(nativeDir, 'embedded-mpv-runtime.json'),
            `${JSON.stringify(SYSTEM_MANIFEST, null, 2)}\n`,
            { mode: 0o644 }
        );
    } else {
        fs.writeFileSync(
            path.join(nativeDir, 'embedded-mpv-unavailable.txt'),
            `Unavailable for ${architecture}\n`
        );
    }

    return { root, appDir, resourceDir, nativeDir };
}

function validElfInspector(binaryPath) {
    const name = path.basename(binaryPath);
    if (name === 'iptvnator_mpv_helper') {
        return {
            soname: null,
            needed: ['libc.so.6', 'libmpv.so.2'],
            rpath: [],
            runpath: ['$ORIGIN/lib'],
        };
    }
    return {
        soname: null,
        needed: ['libc.so.6'],
        rpath: [],
        runpath: [],
    };
}

function successfulProbeRunner() {
    return {
        status: 0,
        signal: null,
        stdout: '{"protocol":1,"usable":true,"libmpv":"0.41.0","renderApi":"egl"}\n',
        stderr: '',
    };
}

test('detects every supported Linux package payload format', () => {
    assert.equal(detectLinuxArtifactFormat('IPTVnator.AppImage'), 'appimage');
    assert.equal(detectLinuxArtifactFormat('IPTVnator.deb'), 'deb');
    assert.equal(detectLinuxArtifactFormat('IPTVnator.rpm'), 'rpm');
    assert.equal(detectLinuxArtifactFormat('IPTVnator.pacman'), 'pacman');
    assert.equal(detectLinuxArtifactFormat('IPTVnator.pkg.tar.zst'), 'pacman');
    assert.equal(detectLinuxArtifactFormat('IPTVnator.snap'), 'snap');
    assert.equal(detectLinuxArtifactFormat('IPTVnator.flatpak'), 'flatpak');
    assert.throws(
        () => detectLinuxArtifactFormat('IPTVnator.tar.gz'),
        /Unsupported Linux package artifact/
    );
});

test('parses the required artifact and profile arguments without evaluating paths', () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-args-')
    );
    const artifactPath = path.join(directory, 'package $(touch owned).deb');
    fs.writeFileSync(artifactPath, 'fixture');

    try {
        assert.deepEqual(
            parseVerifierArguments([
                '--artifact',
                artifactPath,
                '--profile',
                'system',
            ]),
            {
                artifactPath: path.resolve(artifactPath),
                profileName: 'system',
            }
        );
        assert.throws(
            () => parseVerifierArguments(['--artifact', artifactPath]),
            /--profile/
        );
        assert.throws(
            () =>
                parseVerifierArguments([
                    '--artifact',
                    artifactPath,
                    '--profile',
                    'standard',
                ]),
            /Unsupported Linux frame-copy profile/
        );
        assert.throws(
            () =>
                parseVerifierArguments([
                    '--artifact',
                    artifactPath,
                    '--artifact',
                    artifactPath,
                    '--profile',
                    'system',
                ]),
            /duplicate --artifact/
        );
        assert.throws(
            () =>
                parseVerifierArguments([
                    '--artifact',
                    artifactPath,
                    '--profile',
                    'system',
                    '--profile',
                    'system',
                ]),
            /duplicate --profile/
        );
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('extracts every payload format with argument arrays and no shell', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-extract-')
    );
    const invocations = [];
    const runCommand = (command, args, options = {}) => {
        invocations.push({ command, args: [...args], cwd: options.cwd });
        if (command === 'ostree' && args[0] === 'refs') {
            return {
                status: 0,
                stdout: 'app/com.fourgray.iptvnator/x86_64/stable\n',
                stderr: '',
            };
        }
        return { status: 0, stdout: '', stderr: '' };
    };

    try {
        for (const [format, fileName] of [
            ['appimage', 'IPTVnator.AppImage'],
            ['deb', 'IPTVnator.deb'],
            ['rpm', 'IPTVnator.rpm'],
            ['pacman', 'IPTVnator.pacman'],
            ['snap', 'IPTVnator.snap'],
            ['flatpak', 'IPTVnator.flatpak'],
        ]) {
            const artifactPath = path.join(root, fileName);
            const destination = path.join(root, `${format}-payload`);
            fs.writeFileSync(
                artifactPath,
                format === 'appimage'
                    ? Buffer.concat([Buffer.alloc(4096), Buffer.from('hsqs')])
                    : 'fixture'
            );
            fs.mkdirSync(destination);
            extractLinuxArtifact({
                artifactPath,
                format,
                destination,
                runCommand,
            });
        }

        assert.deepEqual(
            invocations.map(({ command }) => command),
            [
                'unsquashfs',
                'dpkg-deb',
                'bsdtar',
                'bsdtar',
                'unsquashfs',
                'ostree',
                'flatpak',
                'ostree',
                'ostree',
            ]
        );
        assert.equal(
            invocations.some(
                ({ command, args }) =>
                    ['sh', 'bash'].includes(command) || args.includes('-c')
            ),
            false
        );
        assert.deepEqual(invocations[1].args.slice(0, 2), [
            '--extract',
            path.join(root, 'IPTVnator.deb'),
        ]);
        assert.deepEqual(invocations[2].args.slice(0, 2), [
            '--extract',
            '--file',
        ]);
        assert.deepEqual(invocations[4].args.slice(0, 2), [
            '-no-progress',
            '-dest',
        ]);
        assert.equal(invocations[5].args[1], 'init');
        assert.ok(invocations[5].args.includes('--mode=archive-z2'));
        assert.equal(invocations[8].args[0], 'checkout');
        assert.ok(invocations[8].args.includes('-U'));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('gives unsquashfs a fresh destination for every AppImage and Snap extraction', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-unsquashfs-')
    );
    const appImagePath = path.join(root, 'IPTVnator.AppImage');
    const snapPath = path.join(root, 'IPTVnator.snap');
    const appImageDestination = path.join(root, 'appimage-payload');
    const snapDestination = path.join(root, 'snap-payload');
    fs.writeFileSync(
        appImagePath,
        Buffer.concat([
            Buffer.alloc(128),
            Buffer.from('hsqs'),
            Buffer.alloc(64),
            Buffer.from('hsqs'),
        ])
    );
    fs.writeFileSync(snapPath, 'snap fixture');
    fs.mkdirSync(appImageDestination);
    fs.mkdirSync(snapDestination);
    let appImageAttempt = 0;

    try {
        extractLinuxArtifact({
            artifactPath: appImagePath,
            format: 'appimage',
            destination: appImageDestination,
            runCommand: (command) => {
                assert.equal(command, 'unsquashfs');
                assert.equal(fs.existsSync(appImageDestination), false);
                appImageAttempt += 1;
                fs.mkdirSync(appImageDestination);
                return {
                    status: appImageAttempt === 1 ? 1 : 0,
                    stdout: '',
                    stderr: '',
                };
            },
        });
        assert.equal(appImageAttempt, 2);

        extractLinuxArtifact({
            artifactPath: snapPath,
            format: 'snap',
            destination: snapDestination,
            runCommand: (command) => {
                assert.equal(command, 'unsquashfs');
                assert.equal(fs.existsSync(snapDestination), false);
                fs.mkdirSync(snapDestination);
                return { status: 0, stdout: '', stderr: '' };
            },
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('initializes a user-checkout OSTree repository before importing Flatpak bundles', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-flatpak-repo-')
    );
    const artifactPath = path.join(root, 'IPTVnator.flatpak');
    const destination = path.join(root, 'flatpak-payload');
    const invocations = [];
    let initializedRepository = null;
    fs.writeFileSync(artifactPath, 'flatpak fixture');

    try {
        extractLinuxArtifact({
            artifactPath,
            format: 'flatpak',
            destination,
            runCommand: (command, args) => {
                invocations.push([command, ...args]);
                if (command === 'ostree' && args.includes('init')) {
                    initializedRepository = args
                        .find((argument) => argument.startsWith('--repo='))
                        ?.slice('--repo='.length);
                    assert.ok(args.includes('--mode=archive-z2'));
                    return { status: 0, stdout: '', stderr: '' };
                }
                if (command === 'flatpak') {
                    assert.equal(args[0], 'build-import-bundle');
                    assert.equal(args[1], initializedRepository);
                    if (!initializedRepository) {
                        return {
                            status: 1,
                            stdout: '',
                            stderr: 'error: opening repo: opendir(objects): No such file or directory',
                        };
                    }
                    return { status: 0, stdout: '', stderr: '' };
                }
                if (command === 'ostree' && args[0] === 'refs') {
                    return {
                        status: 0,
                        stdout: 'app/com.fourgray.iptvnator/x86_64/stable\n',
                        stderr: '',
                    };
                }
                if (command === 'ostree' && args[0] === 'checkout') {
                    assert.ok(args.includes('-U'));
                    return { status: 0, stdout: '', stderr: '' };
                }
                throw new Error(`Unexpected command: ${command}`);
            },
        });

        assert.deepEqual(
            invocations.map(([command, ...args]) => [
                command,
                args.find((argument) =>
                    [
                        'init',
                        'build-import-bundle',
                        'refs',
                        'checkout',
                    ].includes(argument)
                ),
            ]),
            [
                ['ostree', 'init'],
                ['flatpak', 'build-import-bundle'],
                ['ostree', 'refs'],
                ['ostree', 'checkout'],
            ]
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('locates AppImage SquashFS payloads without executing a foreign-arch runtime', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-appimage-')
    );
    const artifactPath = path.join(root, 'arm64.AppImage');
    fs.writeFileSync(
        artifactPath,
        Buffer.concat([
            Buffer.alloc(128, 0x41),
            Buffer.from('hsqs'),
            Buffer.alloc(64),
            Buffer.from('hsqs'),
        ])
    );
    try {
        assert.deepEqual(findAppImageSquashfsOffsets(artifactPath), [128, 196]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('finds one packaged native payload under arbitrary format roots', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-payload-')
    );
    const resourceDir = path.join(root, 'opt', 'IPTVnator', 'resources');
    const nativeDir = path.join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    fs.mkdirSync(nativeDir, { recursive: true });

    try {
        assert.equal(findExtractedResourceDir(root), resourceDir);
        const duplicateNativeDir = path.join(
            root,
            'duplicate',
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        fs.mkdirSync(duplicateNativeDir, { recursive: true });
        assert.throws(
            () => findExtractedResourceDir(root),
            /exactly one embedded MPV native payload/
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('reads x64, arm64, and armv7 ELF architectures without host execution', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-elf-')
    );
    try {
        for (const architecture of ['x64', 'arm64', 'armv7l']) {
            const binaryPath = path.join(root, architecture);
            fs.writeFileSync(binaryPath, elfHeader(architecture));
            assert.equal(readElfArchitecture(binaryPath), architecture);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('requires every direct helper runtime dependency for DEB, RPM, and Pacman', () => {
    assert.deepEqual(
        validateSystemPackageDependencies('deb', [
            'libmpv2 (>= 0.35)',
            'libegl1',
            'libopengl0',
            'libgbm1',
            'libc6',
        ]),
        []
    );
    assert.deepEqual(
        validateSystemPackageDependencies('rpm', [
            'mpv-libs',
            'libglvnd-egl',
            'libglvnd-opengl',
            'mesa-libgbm',
            'glibc',
        ]),
        []
    );
    assert.deepEqual(
        validateSystemPackageDependencies('pacman', [
            'mpv>=0.35',
            'libglvnd',
            'mesa',
            'glibc',
        ]),
        []
    );
    assert.match(
        validateSystemPackageDependencies('deb', [
            'libmpv2',
            'libegl1',
            'libgbm1',
        ])[0],
        /libopengl0/
    );
});

test('reads DEB and RPM metadata without shell pipelines', () => {
    const invocations = [];
    const runCommand = (command, args) => {
        invocations.push({ command, args: [...args] });
        if (command === 'dpkg-deb' && args.at(-1) === 'Architecture') {
            return { status: 0, stdout: 'amd64\n', stderr: '' };
        }
        if (command === 'dpkg-deb') {
            return {
                status: 0,
                stdout: 'libmpv2 (>= 0.35), libc6\n',
                stderr: '',
            };
        }
        if (command === 'rpm' && args.includes('%{ARCH}\\n')) {
            return { status: 0, stdout: 'x86_64\n', stderr: '' };
        }
        return {
            status: 0,
            stdout: 'mpv-libs\nglibc\n',
            stderr: '',
        };
    };

    assert.deepEqual(
        readLinuxArtifactMetadata({
            artifactPath: '/tmp/package name.deb',
            format: 'deb',
            extractionRoot: '/tmp/payload',
            runCommand,
        }),
        {
            declaredArch: 'x64',
            dependencies: ['libmpv2 (>= 0.35)', 'libc6'],
        }
    );
    assert.deepEqual(
        readLinuxArtifactMetadata({
            artifactPath: '/tmp/package name.rpm',
            format: 'rpm',
            extractionRoot: '/tmp/payload',
            runCommand,
        }),
        {
            declaredArch: 'x64',
            dependencies: ['mpv-libs', 'glibc'],
        }
    );
    assert.equal(
        invocations.some(
            ({ command, args }) =>
                ['sh', 'bash'].includes(command) || args.includes('-c')
        ),
        false
    );
});

test('reads Pacman architecture and dependencies from the extracted .PKGINFO', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-pacman-')
    );
    fs.writeFileSync(
        path.join(root, '.PKGINFO'),
        [
            'pkgname = iptvnator',
            'arch = x86_64',
            'depend = mpv>=0.35',
            'depend = glibc',
            '',
        ].join('\n')
    );
    try {
        assert.deepEqual(
            readLinuxArtifactMetadata({
                artifactPath: '/tmp/package.pacman',
                format: 'pacman',
                extractionRoot: root,
            }),
            {
                declaredArch: 'x64',
                dependencies: ['mpv>=0.35', 'glibc'],
            }
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('validates an x64 system payload and executes one bounded helper probe', () => {
    const fixture = createSystemPayload();
    const probeCalls = [];
    try {
        const errors = verifyExtractedLinuxFrameCopyRuntime({
            resourceDir: fixture.resourceDir,
            artifactFormat: 'deb',
            profileName: 'system',
            packageDependencies: [
                'libmpv2 (>= 0.35)',
                'libegl1',
                'libopengl0',
                'libgbm1',
            ],
            elfInspector: validElfInspector,
            probeRunner(command, args, options) {
                probeCalls.push({ command, args, options });
                return successfulProbeRunner();
            },
            environment: {
                PATH: '/usr/bin',
                LD_AUDIT: '/host/can-inject-audit.so',
                LD_LIBRARY_PATH: '/host/can-mask-missing-dependencies',
                LD_PRELOAD: '/host/can-inject.so',
            },
        });
        assert.deepEqual(errors, []);
        assert.equal(probeCalls.length, 1);
        assert.equal(
            probeCalls[0].command,
            path.join(fixture.nativeDir, 'iptvnator_mpv_helper')
        );
        assert.deepEqual(probeCalls[0].args, ['--runtime-probe']);
        assert.deepEqual(probeCalls[0].options, {
            encoding: 'utf8',
            env: { PATH: '/usr/bin' },
            killSignal: 'SIGKILL',
            timeout: 3000,
            windowsHide: true,
        });
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('excludes only Snap template library roots from Electron isolation checks', () => {
    const fixture = createSystemPayload({ architecture: 'arm64' });
    const packageLibraryDirs = [
        path.join(fixture.appDir, 'lib', 'x86_64-linux-gnu'),
        path.join(fixture.appDir, 'usr', 'lib', 'x86_64-linux-gnu'),
    ];
    const electronLibrary = path.join(fixture.appDir, 'libelectron-extra.so');
    for (const [index, packageLibraryDir] of packageLibraryDirs.entries()) {
        const packageLibraryTarget = path.join(
            packageLibraryDir,
            `libpackage-${index}.so.0.12.2`
        );
        fs.mkdirSync(packageLibraryDir, { recursive: true });
        fs.writeFileSync(packageLibraryTarget, 'package-managed library');
        fs.symlinkSync(
            path.basename(packageLibraryTarget),
            path.join(packageLibraryDir, `libpackage-${index}.so.0`)
        );
    }
    fs.writeFileSync(electronLibrary, 'electron library');

    const inspectedPaths = [];
    const isPackageLibraryPath = (binaryPath) =>
        packageLibraryDirs.some((packageLibraryDir) =>
            path
                .resolve(binaryPath)
                .startsWith(`${path.resolve(packageLibraryDir)}${path.sep}`)
        );
    const ownershipScopedElfInspector = (binaryPath) => {
        inspectedPaths.push(binaryPath);
        if (isPackageLibraryPath(binaryPath)) {
            throw new Error(
                'package-manager library tree crossed the Electron ownership boundary'
            );
        }
        return validElfInspector(binaryPath);
    };

    try {
        assert.deepEqual(
            verifyExtractedLinuxFrameCopyRuntime({
                resourceDir: fixture.resourceDir,
                artifactFormat: 'snap',
                profileName: 'portable',
                packageDependencies: [],
                elfInspector: ownershipScopedElfInspector,
                probeRunner() {
                    assert.fail('foreign-architecture Snap must not probe');
                },
            }),
            []
        );
        assert.ok(inspectedPaths.includes(electronLibrary));
        assert.equal(inspectedPaths.some(isPackageLibraryPath), false);

        const isolationErrors = verifyExtractedLinuxFrameCopyRuntime({
            resourceDir: fixture.resourceDir,
            artifactFormat: 'snap',
            profileName: 'portable',
            packageDependencies: [],
            elfInspector(binaryPath) {
                if (binaryPath === electronLibrary) {
                    return {
                        soname: null,
                        needed: ['libmpv.so.2'],
                        rpath: [],
                        runpath: [],
                    };
                }
                return ownershipScopedElfInspector(binaryPath);
            },
            probeRunner() {
                assert.fail('foreign-architecture Snap must not probe');
            },
        });
        assert.match(
            isolationErrors.join('\n'),
            /Electron library must not link libmpv.*libelectron-extra\.so/
        );

        const nestedElectronLibrary = path.join(
            fixture.appDir,
            'future-electron-runtime',
            'libfuture-electron.so'
        );
        fs.mkdirSync(path.dirname(nestedElectronLibrary), {
            recursive: true,
        });
        fs.writeFileSync(nestedElectronLibrary, 'nested electron library');
        const nestedIsolationErrors = verifyExtractedLinuxFrameCopyRuntime({
            resourceDir: fixture.resourceDir,
            artifactFormat: 'snap',
            profileName: 'portable',
            packageDependencies: [],
            elfInspector(binaryPath) {
                if (binaryPath === nestedElectronLibrary) {
                    return {
                        soname: null,
                        needed: ['libmpv.so.2'],
                        rpath: [],
                        runpath: [],
                    };
                }
                return ownershipScopedElfInspector(binaryPath);
            },
            probeRunner() {
                assert.fail('foreign-architecture Snap must not probe');
            },
        });
        assert.match(
            nestedIsolationErrors.join('\n'),
            /Electron library must not link libmpv.*libfuture-electron\.so/
        );

        fs.symlinkSync(
            path.basename(electronLibrary),
            path.join(fixture.appDir, 'libEGL.so')
        );
        const symlinkErrors = verifyExtractedLinuxFrameCopyRuntime({
            resourceDir: fixture.resourceDir,
            artifactFormat: 'snap',
            profileName: 'portable',
            packageDependencies: [],
            elfInspector: ownershipScopedElfInspector,
            probeRunner() {
                assert.fail('foreign-architecture Snap must not probe');
            },
        });
        assert.match(
            symlinkErrors.join('\n'),
            /Electron library must be a regular file: .*libEGL\.so/
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('rejects helper probes terminated by a signal or hard timeout', () => {
    for (const probeResult of [
        {
            status: null,
            signal: 'SIGKILL',
            stdout: '',
            stderr: '',
        },
        {
            error: Object.assign(new Error('spawnSync helper ETIMEDOUT'), {
                code: 'ETIMEDOUT',
            }),
            status: null,
            signal: 'SIGKILL',
            stdout: '',
            stderr: '',
        },
    ]) {
        const fixture = createSystemPayload();
        try {
            const errors = verifyExtractedLinuxFrameCopyRuntime({
                resourceDir: fixture.resourceDir,
                artifactFormat: 'deb',
                profileName: 'system',
                packageDependencies: DEB_SYSTEM_PACKAGE_DEPENDENCIES,
                elfInspector: validElfInspector,
                probeRunner() {
                    return probeResult;
                },
            });
            assert.match(
                errors.join('\n'),
                /(?:runtime probe terminated by signal SIGKILL|Unable to execute .*ETIMEDOUT)/
            );
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true });
        }
    }
});

test('requires a private top-level shared-memory plug used by the Snap app', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-snap-metadata-')
    );
    const snapYamlPath = path.join(root, 'meta', 'snap.yaml');
    fs.mkdirSync(path.dirname(snapYamlPath), { recursive: true });

    const validSnapYaml = [
        'name: iptvnator',
        'summary: "*literal &anchor !tag <<: is quoted"',
        '# *commented-alias &commented-anchor !commented-tag',
        'apps:',
        '  iptvnator:',
        '    command: iptvnator',
        '    plugs:',
        '      - desktop',
        '      - shared-memory',
        'plugs:',
        '  shared-memory:',
        '    interface: shared-memory',
        '    private: true',
        '',
    ].join('\n');

    try {
        fs.writeFileSync(snapYamlPath, validSnapYaml);
        assert.deepEqual(validateExtractedSnapMetadata(root), []);

        for (const [mutate, expected] of [
            [
                (contents) =>
                    contents.replace('    private: true', '    private: false'),
                /private: true/,
            ],
            [
                (contents) => contents.replace('      - shared-memory\n', ''),
                /app.*shared-memory plug/i,
            ],
            [
                (contents) =>
                    contents.replace(
                        '  shared-memory:\n    interface: shared-memory\n    private: true\n',
                        ''
                    ),
                /top-level shared-memory plug/i,
            ],
            [
                (contents) =>
                    contents.replace(
                        '    private: true\n',
                        '    private: true\n    shared-memory: named-area\n'
                    ),
                /private shared-memory plug.*exactly interface and private/i,
            ],
            [
                (contents) =>
                    contents.replace(
                        '\nplugs:\n',
                        [
                            '',
                            'plugs:',
                            '  second-shared-memory:',
                            '    interface: shared-memory',
                            '    private: true',
                            '',
                        ].join('\n')
                    ),
                /exactly one plug.*shared-memory interface/i,
            ],
            [
                (contents) =>
                    `${contents}slots:\n  shared-memory:\n    interface: shared-memory\n`,
                /must not declare.*shared-memory slot/i,
            ],
            [
                (contents) =>
                    contents.replace(
                        '\nplugs:\n',
                        '\nplugs:\n  other: { interface: shared-memory }\n'
                    ),
                /plug declarations.*block mappings/i,
            ],
            [
                (contents) =>
                    `${contents}slots: { leak: { interface: shared-memory } }\n`,
                /slots.*block mappings/i,
            ],
            [
                (contents) =>
                    contents.replace(
                        '\nplugs:\n',
                        '\nplugs:\n  network:\n    interface: network\n  network:\n    interface: network\n'
                    ),
                /plug keys.*unique/i,
            ],
            [
                (contents) =>
                    [
                        'shared-interface: &shared.interface shared-memory',
                        contents.replace(
                            '\nplugs:\n',
                            '\nplugs:\n  alias-plug:\n    interface: *shared.interface\n'
                        ),
                    ].join('\n'),
                /anchors, aliases, merge keys, or custom tags/i,
            ],
            [
                (contents) =>
                    [
                        'shared-interface: &sharedInterface shared-memory',
                        `${contents}slots:\n  alias-slot:\n    interface: *sharedInterface\n`,
                    ].join('\n'),
                /anchors, aliases, merge keys, or custom tags/i,
            ],
            [
                (contents) =>
                    contents.replace(
                        '\nplugs:\n',
                        '\nplugs:\n  tagged:\n    interface: !shared-memory shared-memory\n'
                    ),
                /anchors, aliases, merge keys, or custom tags/i,
            ],
            [
                (contents) =>
                    [
                        'shared-plug: &sharedPlug',
                        '  interface: network',
                        contents.replace(
                            '\nplugs:\n',
                            '\nplugs:\n  merged:\n    <<: *sharedPlug\n'
                        ),
                    ].join('\n'),
                /anchors, aliases, merge keys, or custom tags/i,
            ],
            [
                (contents) =>
                    contents.replace(
                        [
                            '    plugs:',
                            '      - desktop',
                            '      - shared-memory',
                        ].join('\n'),
                        [
                            '    plugs:',
                            '      nested:',
                            '        - shared-memory',
                        ].join('\n')
                    ),
                /scalar sequence.*shared-memory/i,
            ],
        ]) {
            fs.writeFileSync(snapYamlPath, mutate(validSnapYaml));
            assert.match(
                validateExtractedSnapMetadata(root).join('\n'),
                expected
            );
        }

        fs.rmSync(snapYamlPath);
        assert.match(
            validateExtractedSnapMetadata(root).join('\n'),
            /Missing extracted Snap metadata/
        );

        fs.writeFileSync(path.join(root, 'outside.yaml'), validSnapYaml);
        fs.symlinkSync(
            path.join(root, 'outside.yaml'),
            snapYamlPath,
            process.platform === 'win32' ? 'file' : undefined
        );
        assert.match(
            validateExtractedSnapMetadata(root).join('\n'),
            /regular file/
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

const SNAP_METADATA_WITH_LITERAL_HASHES = [
    'name: iptvnator',
    'summary: "quoted # is scalar data"',
    'description: | # block scalar header comment',
    '  Block scalar # stays literal.',
    'apps:',
    '  iptvnator:',
    '    command: iptvnator',
    '    plugs:',
    '      - shared-memory',
    'plugs:',
    '  shared-memory:',
    '    interface: shared-memory',
    '    private: true',
    '',
].join('\n');

for (const [kind, mutate, expected] of [
    [
        'plug',
        (contents) =>
            contents.replace(
                '\nplugs:\n',
                [
                    '',
                    'plugs:',
                    '  hidden-extra-plug:',
                    '    interface: shared-memory # trailing comment',
                    '',
                ].join('\n')
            ),
        /exactly one plug.*shared-memory interface/i,
    ],
    [
        'slot',
        (contents) =>
            `${contents}slots:\n  hidden-slot:\n    interface: shared-memory # trailing comment\n`,
        /must not declare.*shared-memory slot/i,
    ],
]) {
    test(`rejects an extra Snap shared-memory ${kind} with a trailing comment`, () => {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), 'iptvnator-verifier-snap-comments-')
        );
        const snapYamlPath = path.join(root, 'meta', 'snap.yaml');
        fs.mkdirSync(path.dirname(snapYamlPath), { recursive: true });

        try {
            fs.writeFileSync(snapYamlPath, SNAP_METADATA_WITH_LITERAL_HASHES);
            assert.deepEqual(validateExtractedSnapMetadata(root), []);

            fs.writeFileSync(
                snapYamlPath,
                mutate(SNAP_METADATA_WITH_LITERAL_HASHES)
            );
            assert.match(
                validateExtractedSnapMetadata(root).join('\n'),
                expected
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}

test('artifact verification rejects Snap metadata before accepting its payload', () => {
    const fixture = createSystemPayload();
    const artifactPath = path.join(fixture.root, 'package.snap');
    const snapYamlPath = path.join(fixture.root, 'meta', 'snap.yaml');
    fs.writeFileSync(artifactPath, 'fixture');
    fs.mkdirSync(path.dirname(snapYamlPath), { recursive: true });
    fs.writeFileSync(
        snapYamlPath,
        [
            'name: iptvnator',
            'apps:',
            '  iptvnator:',
            '    command: iptvnator',
            '    plugs:',
            '      - desktop',
            'plugs:',
            '  shared-memory:',
            '    interface: shared-memory',
            '    private: true',
            '',
        ].join('\n')
    );
    let payloadVerifierCalls = 0;

    const verify = () =>
        verifyLinuxFrameCopyArtifact({
            artifactPath,
            profileName: 'portable',
            extractArtifact() {
                return fixture.root;
            },
            metadataReader() {
                return { declaredArch: 'x64', dependencies: [] };
            },
            payloadVerifier() {
                payloadVerifierCalls += 1;
                return [];
            },
        });

    try {
        assert.throws(verify, /app.*shared-memory plug/i);
        assert.equal(payloadVerifierCalls, 0);

        fs.writeFileSync(
            snapYamlPath,
            fs
                .readFileSync(snapYamlPath, 'utf8')
                .replace('      - desktop\n', '      - shared-memory\n')
        );
        assert.deepEqual(verify(), {
            artifactPath,
            format: 'snap',
            profileName: 'portable',
            architecture: 'x64',
        });
        assert.equal(payloadVerifierCalls, 1);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('bundled probes use only the packaged library directory', () => {
    assert.deepEqual(
        createRuntimeProbeEnvironment({
            environment: {
                PATH: '/usr/bin',
                LD_AUDIT: '/host/can-inject-audit.so',
                LD_LIBRARY_PATH: '/host/can-mask-missing-dependencies',
                LD_PRELOAD: '/host/can-inject.so',
            },
            nativeDir: '/package/resources/native',
            runtimeMode: 'bundled',
        }),
        {
            PATH: '/usr/bin',
            LD_LIBRARY_PATH: '/package/resources/native/lib',
        }
    );
});

test('rejects helper probe framing and fields that runtime capability rejects', () => {
    const validPayload =
        '{"protocol":1,"usable":true,"libmpv":"0.41.0","renderApi":"egl"}';
    for (const stdout of [
        validPayload,
        `${validPayload}\n\n`,
        `${validPayload.slice(0, -1)},"extra":true}\n`,
    ]) {
        const fixture = createSystemPayload();
        try {
            const errors = verifyExtractedLinuxFrameCopyRuntime({
                resourceDir: fixture.resourceDir,
                artifactFormat: 'deb',
                profileName: 'system',
                packageDependencies: DEB_SYSTEM_PACKAGE_DEPENDENCIES,
                elfInspector: validElfInspector,
                probeRunner() {
                    return {
                        status: 0,
                        signal: null,
                        stdout,
                        stderr: '',
                    };
                },
            });
            assert.match(
                errors.join('\n'),
                /runtime probe (?:must emit|did not return)/
            );
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true });
        }
    }
});

test('reports missing helper, wrong mode, wrong profile, isolation, and loader failures', () => {
    const cases = [
        {
            mutate({ nativeDir }) {
                fs.rmSync(path.join(nativeDir, 'iptvnator_mpv_helper'));
            },
            expected: /Missing embedded MPV frame-copy helper/,
        },
        {
            mutate({ nativeDir }) {
                fs.chmodSync(
                    path.join(nativeDir, 'iptvnator_mpv_helper'),
                    0o644
                );
            },
            expected: /must have mode 0755/,
        },
        {
            profileName: 'portable',
            expected: /does not include target "deb"/,
        },
        {
            elfInspector(binaryPath) {
                if (path.basename(binaryPath) === 'embedded_mpv.node') {
                    return {
                        soname: null,
                        needed: ['libmpv.so.2'],
                        rpath: [],
                        runpath: [],
                    };
                }
                return validElfInspector(binaryPath);
            },
            expected: /addon must not link libmpv/,
        },
        {
            probeRunner() {
                return {
                    status: 127,
                    signal: null,
                    stdout: '',
                    stderr: 'error while loading shared libraries: libmpv.so.2',
                };
            },
            expected: /runtime probe failed with status 127.*libmpv\.so\.2/s,
        },
    ];

    for (const testCase of cases) {
        const fixture = createSystemPayload();
        try {
            testCase.mutate?.(fixture);
            const errors = verifyExtractedLinuxFrameCopyRuntime({
                resourceDir: fixture.resourceDir,
                artifactFormat: 'deb',
                profileName: testCase.profileName ?? 'system',
                packageDependencies: DEB_SYSTEM_PACKAGE_DEPENDENCIES,
                elfInspector: testCase.elfInspector ?? validElfInspector,
                probeRunner: testCase.probeRunner ?? successfulProbeRunner,
            });
            assert.match(errors.join('\n'), testCase.expected);
        } finally {
            fs.rmSync(fixture.root, { recursive: true, force: true });
        }
    }
});

test('rejects an x64 package manifest produced from a target subset', () => {
    const fixture = createSystemPayload();
    const manifestPath = path.join(
        fixture.nativeDir,
        'embedded-mpv-runtime.json'
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.targets = ['deb'];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    try {
        const errors = verifyExtractedLinuxFrameCopyRuntime({
            resourceDir: fixture.resourceDir,
            artifactFormat: 'deb',
            profileName: 'system',
            packageDependencies: DEB_SYSTEM_PACKAGE_DEPENDENCIES,
            elfInspector: validElfInspector,
            probeRunner: successfulProbeRunner,
        });
        assert.match(
            errors.join('\n'),
            /manifest targets.*must equal \["deb","pacman","rpm"\]/
        );
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('requires marker-only foreign packages, scans Electron, and never probes', () => {
    const fixture = createSystemPayload({ architecture: 'arm64' });
    let probeCalls = 0;
    try {
        assert.deepEqual(
            verifyExtractedLinuxFrameCopyRuntime({
                resourceDir: fixture.resourceDir,
                artifactFormat: 'appimage',
                profileName: 'portable',
                packageDependencies: [],
                elfInspector: validElfInspector,
                probeRunner() {
                    probeCalls += 1;
                    return successfulProbeRunner();
                },
            }),
            []
        );
        assert.equal(probeCalls, 0);

        const isolationErrors = verifyExtractedLinuxFrameCopyRuntime({
            resourceDir: fixture.resourceDir,
            artifactFormat: 'appimage',
            profileName: 'portable',
            packageDependencies: [],
            elfInspector(binaryPath) {
                if (path.basename(binaryPath) === 'iptvnator.bin') {
                    return {
                        soname: null,
                        needed: ['/tmp/libmpv.so.2'],
                        rpath: [],
                        runpath: [],
                    };
                }
                return validElfInspector(binaryPath);
            },
            probeRunner() {
                probeCalls += 1;
                return successfulProbeRunner();
            },
        });
        assert.match(
            isolationErrors.join('\n'),
            /Electron binary must not link libmpv/
        );
        assert.equal(probeCalls, 0);

        for (const forbiddenDependency of DEB_SYSTEM_PACKAGE_DEPENDENCIES) {
            const dependencyErrors = verifyExtractedLinuxFrameCopyRuntime({
                resourceDir: fixture.resourceDir,
                artifactFormat: 'deb',
                profileName: 'system',
                packageDependencies: [forbiddenDependency, 'libc6'],
                declaredArch: 'arm64',
                elfInspector: validElfInspector,
                probeRunner: successfulProbeRunner,
            });
            assert.match(
                dependencyErrors.join('\n'),
                new RegExp(
                    `must not declare frame-copy dependency ${forbiddenDependency}`
                )
            );
        }
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});

test('always removes its temporary extraction root after a verifier failure', () => {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-verifier-cleanup-parent-')
    );
    const artifactPath = path.join(root, 'package.deb');
    fs.writeFileSync(artifactPath, 'fixture');
    let extractionDestination;

    try {
        assert.throws(
            () =>
                verifyLinuxFrameCopyArtifact({
                    artifactPath,
                    profileName: 'system',
                    extractArtifact({ destination }) {
                        extractionDestination = destination;
                        fs.writeFileSync(
                            path.join(path.dirname(destination), 'sentinel'),
                            'temporary'
                        );
                        throw new Error('intentional extraction failure');
                    },
                }),
            /intentional extraction failure/
        );
        assert.equal(
            fs.existsSync(path.dirname(extractionDestination)),
            false,
            'temporary verifier root must be removed'
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
