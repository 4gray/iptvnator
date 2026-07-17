import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageMetadata = JSON.parse(
    fs.readFileSync(join(currentDir, '..', '..', 'package.json'), 'utf8')
);
const buildAndMakeWorkflow = fs.readFileSync(
    join(currentDir, '..', '..', '.github', 'workflows', 'build-and-make.yaml'),
    'utf8'
);
const electronBuilderConfig = JSON.parse(
    fs.readFileSync(
        join(currentDir, '..', '..', 'electron-builder.json'),
        'utf8'
    )
);
const electronProjectConfig = JSON.parse(
    fs.readFileSync(
        join(
            currentDir,
            '..',
            '..',
            'apps',
            'electron-backend',
            'project.json'
        ),
        'utf8'
    )
);
const makerOptions = JSON.parse(
    fs.readFileSync(
        join(
            currentDir,
            '..',
            '..',
            'apps',
            'electron-backend',
            'src',
            'app',
            'options',
            'maker.options.json'
        ),
        'utf8'
    )
);
const generatedMetadataConfigPath =
    'apps/electron-backend/src/app/options/electron-builder.metadata.generated.json';
const packageLayoutVerifier = fs.readFileSync(
    join(currentDir, 'verify-electron-package-layout.mjs'),
    'utf8'
);
const electronAfterPackSource = fs.readFileSync(
    join(currentDir, 'electron-after-pack.cjs'),
    'utf8'
);
const frameCopyFilesModulePath = join(
    currentDir,
    'embedded-mpv-frame-copy-files.cjs'
);
const embeddedMpvPackagingSource = fs.readFileSync(
    join(currentDir, 'embedded-mpv-packaging.cjs'),
    'utf8'
);
const embeddedMpvBuildSource = fs.readFileSync(
    join(
        currentDir,
        '..',
        '..',
        'apps',
        'electron-backend',
        'build-embedded-mpv.js'
    ),
    'utf8'
);
const embeddedMpvStageRuntimeSource = fs.readFileSync(
    join(currentDir, '..', 'embedded-mpv', 'stage-runtime.mjs'),
    'utf8'
);
const embeddedMpvWindowsArchiveStageSource = fs.readFileSync(
    join(currentDir, '..', 'embedded-mpv', 'stage-windows-runtime-archive.mjs'),
    'utf8'
);
const embeddedMpvWin32Source = fs.readFileSync(
    join(
        currentDir,
        '..',
        '..',
        'apps',
        'electron-backend',
        'native',
        'src',
        'embedded_mpv_win32.cc'
    ),
    'utf8'
);
const { validatePackagedEmbeddedMpv } = require('./embedded-mpv-packaging.cjs');

function writeWindowsHelperFixture(helperPath, importedDllName) {
    const peOffset = 0x80;
    const optionalHeaderOffset = peOffset + 24;
    const optionalHeaderSize = 0xf0;
    const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
    const importRva = 0x1000;
    const importRawOffset = 0x200;
    const importNameOffset = 0x30;
    const image = Buffer.alloc(0x400);

    image.write('MZ', 0, 'ascii');
    image.writeUInt32LE(peOffset, 0x3c);
    image.write('PE\0\0', peOffset, 'ascii');
    image.writeUInt16LE(0x8664, peOffset + 4);
    image.writeUInt16LE(1, peOffset + 6);
    image.writeUInt16LE(optionalHeaderSize, peOffset + 20);
    image.writeUInt16LE(0x20b, optionalHeaderOffset);
    image.writeUInt32LE(0x200, optionalHeaderOffset + 60);
    image.writeUInt32LE(16, optionalHeaderOffset + 108);
    image.writeUInt32LE(importRva, optionalHeaderOffset + 120);
    image.writeUInt32LE(40, optionalHeaderOffset + 124);
    image.write('.idata\0\0', sectionTableOffset, 'ascii');
    image.writeUInt32LE(0x200, sectionTableOffset + 8);
    image.writeUInt32LE(importRva, sectionTableOffset + 12);
    image.writeUInt32LE(0x200, sectionTableOffset + 16);
    image.writeUInt32LE(importRawOffset, sectionTableOffset + 20);
    image.writeUInt32LE(importRva + importNameOffset, importRawOffset + 12);
    image.write(`${importedDllName}\0`, importRawOffset + importNameOffset);
    fs.writeFileSync(helperPath, image);
}

test('Linux package identity does not expose the internal Electron backend project name', () => {
    assert.equal(electronBuilderConfig.productName, 'IPTVnator');
    assert.equal(electronBuilderConfig.extraMetadata?.name, 'iptvnator');
    assert.equal(electronBuilderConfig.extraMetadata?.productName, 'IPTVnator');
    assert.equal(electronBuilderConfig.linux?.executableName, 'iptvnator');
    assert.equal(
        electronBuilderConfig.linux?.desktop?.entry?.StartupWMClass,
        'iptvnator'
    );
    assert.ok(
        electronBuilderConfig.linux?.executableArgs?.includes(
            '--ozone-platform=x11'
        )
    );
});

test('GitHub Releases auto-update metadata is generated and uploaded', () => {
    // \r?\n keeps this host-agnostic: Windows checkouts with autocrlf see
    // CRLF in the workflow file.
    const releaseFiles = buildAndMakeWorkflow.match(
        /files: \|\r?\n([\s\S]*?)\r?\n\s+env:/
    )?.[1];

    assert.ok(releaseFiles, 'release upload files block must exist');
    assert.ok(
        packageMetadata.dependencies?.['electron-updater'],
        'electron-updater must be a runtime dependency because the packaged app imports it'
    );
    assert.deepEqual(electronBuilderConfig.publish, [
        {
            provider: 'github',
            owner: '4gray',
            repo: 'iptvnator',
        },
    ]);
    assert.deepEqual(electronBuilderConfig.mac?.target, [
        {
            target: 'dmg',
            arch: ['x64', 'arm64'],
        },
        {
            target: 'zip',
            arch: ['x64', 'arm64'],
        },
    ]);
    assert.match(buildAndMakeWorkflow, /dist\/executables\/\*\*\/latest\.yml/);
    assert.match(
        buildAndMakeWorkflow,
        /dist\/executables\/\*\*\/latest-mac\.yml/
    );
    assert.match(
        buildAndMakeWorkflow,
        /dist\/executables\/\*\*\/latest-linux\*\.yml/
    );
    assert.match(buildAndMakeWorkflow, /dist\/executables\/\*\*\/\*\.blockmap/);
    assert.match(buildAndMakeWorkflow, /Merge macOS updater metadata/);
    assert.match(buildAndMakeWorkflow, /artifacts\/latest-mac\.yml/);
    assert.doesNotMatch(
        releaseFiles,
        /artifacts\/macos-(?:x64|arm64)-artifacts\/latest-mac\.yml/
    );
    assert.match(
        buildAndMakeWorkflow,
        /artifacts\/linux-artifacts\/latest-linux\*\.yml/
    );
    assert.match(
        buildAndMakeWorkflow,
        /artifacts\/windows-artifacts\/latest\.yml/
    );

    const makeCommands = [
        ...buildAndMakeWorkflow.matchAll(/run: (pnpm run make:app[^\n]*)/g),
    ].map((match) => match[1].trim());
    assert.ok(makeCommands.length >= 2, 'workflow must package Electron apps');
    assert.deepEqual(
        [...new Set(makeCommands)],
        ['pnpm run make:app -- --publishPolicy=never']
    );
});

test('generated Electron package metadata mirrors the root package identity', async () => {
    const { buildElectronBuilderMetadata, buildElectronPackageMetadata } =
        await import('./generate-electron-builder-metadata.mjs');
    const generatedElectronPackage = buildElectronPackageMetadata(
        packageMetadata,
        electronBuilderConfig,
        {
            name: 'electron-backend',
            version: '0.0.1',
            dependencies: {
                'better-sqlite3': '12.5.0',
            },
        }
    );

    assert.deepEqual(
        buildElectronBuilderMetadata(packageMetadata, electronBuilderConfig)
            .extraMetadata,
        {
            name: packageMetadata.name,
            productName: electronBuilderConfig.productName,
            version: packageMetadata.version,
            description: packageMetadata.description,
            author: packageMetadata.author,
            homepage: packageMetadata.homepage,
            license: packageMetadata.license,
            main: electronBuilderConfig.extraMetadata.main,
        }
    );
    assert.deepEqual(generatedElectronPackage, {
        name: packageMetadata.name,
        productName: electronBuilderConfig.productName,
        version: packageMetadata.version,
        description: packageMetadata.description,
        author: packageMetadata.author,
        homepage: packageMetadata.homepage,
        license: packageMetadata.license,
        main: electronBuilderConfig.extraMetadata.main,
        dependencies: {
            'better-sqlite3': '12.5.0',
        },
    });
});

test('nx-electron packaging prepares metadata before make/package', () => {
    assert.equal(makerOptions.extends, generatedMetadataConfigPath);
    assert.deepEqual(
        electronProjectConfig.targets['generate-builder-metadata'].dependsOn,
        ['electron-backend:build']
    );
    assert.deepEqual(
        electronProjectConfig.targets['generate-builder-metadata'].outputs,
        [
            `{workspaceRoot}/${generatedMetadataConfigPath}`,
            '{workspaceRoot}/dist/apps/electron-backend/package.json',
        ]
    );
    assert.ok(
        electronProjectConfig.targets.make.dependsOn.includes(
            'electron-backend:generate-builder-metadata'
        )
    );
    assert.ok(
        electronProjectConfig.targets.package.dependsOn.includes(
            'electron-backend:generate-builder-metadata'
        )
    );
});

test('package layout verifier uses canonical helpers and direct dependencies', () => {
    assert.ok(packageMetadata.devDependencies?.['@electron/asar']);
    assert.match(packageLayoutVerifier, /require\(['"]@electron\/asar['"]\)/);
    assert.doesNotMatch(packageLayoutVerifier, /electronBuilderRequire/);
    assert.match(
        packageLayoutVerifier,
        /buildElectronBuilderMetadata\(\s*packageMetadata,\s*electronBuilderConfig\s*\)\.extraMetadata/s
    );
    assert.doesNotMatch(
        packageLayoutVerifier,
        /const packagedPackageMetadata = \{\s*name:/s
    );
    assert.doesNotMatch(
        packageLayoutVerifier,
        /builderEffectiveConfigPath && fileExists\(builderEffectiveConfigPath\)/
    );
    assert.match(packageLayoutVerifier, /IPTVNATOR_LINUX_FRAME_COPY_PROFILE/);
    assert.match(packageLayoutVerifier, /profile:\s*linuxFrameCopyProfile/);
    assert.match(packageLayoutVerifier, /targetNames:\s*linuxTargetNames/);
    assert.match(
        packageLayoutVerifier,
        /validateLinuxProfileTargets\(\s*linuxFrameCopyProfile,\s*linuxTargetNames\s*\)/s
    );
    assert.match(packageLayoutVerifier, /dirArch !== 'x64'/);
    assert.doesNotMatch(packageLayoutVerifier, /getEmbeddedMpvAddonArch/);
    assert.match(electronAfterPackSource, /targetArch !== 'x64'/);
});

test('nx-electron packaging does not copy duplicate root package metadata', () => {
    const nxElectronExecutorPath =
        require.resolve('nx-electron/src/executors/package/executor.js');
    const nxElectronExecutor = fs.readFileSync(nxElectronExecutorPath, 'utf8');

    assert.doesNotMatch(nxElectronExecutor, /['"]\.\/package\.json['"]/);
    assert.match(
        nxElectronExecutor,
        /filter:\s*\[['"]index\.js['"],\s*['"]package\.json['"]\]/
    );
});

test('embedded MPV runtime binaries are unpacked on every supported desktop platform', () => {
    const asarUnpack = electronBuilderConfig.asarUnpack ?? [];

    for (const requiredPattern of [
        '**/*.node',
        '**/*.dylib',
        '**/*.dll',
        '**/*.so',
        '**/*.so.*',
        '**/embedded-mpv-runtime.json',
    ]) {
        assert.ok(
            asarUnpack.includes(requiredPattern),
            `electron-builder asarUnpack must include ${requiredPattern}`
        );
    }
});

test('embedded MPV package validation accepts Windows runtime files and Linux process isolation', () => {
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'iptvnator-mpv-package-'));

    try {
        for (const [platform, runtimeFile] of [
            ['windows', 'mpv-2.dll'],
            ['windows', 'libmpv-2.dll'],
            ['windows', 'mpv.dll'],
            ['windows', 'libmpv.dll'],
        ]) {
            // One fixture dir per runtime-file scenario: the frame-copy
            // artifacts written below must not leak into the next
            // iteration's missing-artifact assertions.
            const resourceDir = join(
                tempDir,
                `${platform}-${runtimeFile.replace(/[\\/]/g, '_')}`
            );
            const nativeDir = join(
                resourceDir,
                'app.asar.unpacked',
                'electron-backend',
                'native'
            );
            fs.mkdirSync(join(nativeDir, 'lib'), { recursive: true });
            fs.writeFileSync(join(nativeDir, 'embedded_mpv.node'), '');
            fs.writeFileSync(
                join(nativeDir, 'embedded-mpv-runtime.json'),
                JSON.stringify({ origin: 'vendored-lgpl' })
            );
            fs.writeFileSync(join(nativeDir, runtimeFile), '');

            // Windows packages that ship the addon must also ship the
            // frame-copy engine artifacts built by the same binding.gyp run.
            const missingWindowsFrameCopyErrors = validatePackagedEmbeddedMpv(
                resourceDir,
                { platform, required: true }
            );
            assert.ok(
                missingWindowsFrameCopyErrors.some((error) =>
                    error.includes('iptvnator_mpv_helper.exe')
                )
            );
            assert.ok(
                missingWindowsFrameCopyErrors.some((error) =>
                    error.includes('embedded_mpv_frame_reader.node')
                )
            );

            writeWindowsHelperFixture(
                join(nativeDir, 'iptvnator_mpv_helper.exe'),
                runtimeFile
            );
            fs.writeFileSync(
                join(nativeDir, 'embedded_mpv_frame_reader.node'),
                ''
            );

            assert.deepEqual(
                validatePackagedEmbeddedMpv(resourceDir, {
                    platform,
                    required: true,
                }),
                []
            );
        }

        const darwinResourceDir = join(tempDir, 'darwin');
        const darwinNativeDir = join(
            darwinResourceDir,
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        fs.mkdirSync(join(darwinNativeDir, 'lib'), { recursive: true });
        fs.writeFileSync(join(darwinNativeDir, 'embedded_mpv.node'), '');
        fs.writeFileSync(
            join(darwinNativeDir, 'embedded-mpv-runtime.json'),
            JSON.stringify({ origin: 'vendored-lgpl' })
        );
        fs.writeFileSync(join(darwinNativeDir, 'lib', 'libmpv.2.dylib'), '');

        // macOS packages that ship the addon must also ship the frame-copy
        // engine artifacts built by the same binding.gyp run.
        const missingFrameCopyErrors = validatePackagedEmbeddedMpv(
            darwinResourceDir,
            { platform: 'darwin', required: true }
        );
        assert.ok(
            missingFrameCopyErrors.some((error) =>
                error.includes('iptvnator_mpv_helper')
            )
        );
        assert.ok(
            missingFrameCopyErrors.some((error) =>
                error.includes('embedded_mpv_frame_reader.node')
            )
        );

        fs.writeFileSync(join(darwinNativeDir, 'iptvnator_mpv_helper'), '');
        fs.writeFileSync(
            join(darwinNativeDir, 'embedded_mpv_frame_reader.node'),
            ''
        );
        // Host-agnostic assertion: on non-macOS hosts the validator also
        // reports that link validation needs a macOS host, so only the
        // frame-copy artifact requirement is asserted here.
        const remainingErrors = validatePackagedEmbeddedMpv(darwinResourceDir, {
            platform: 'darwin',
            required: true,
        });
        assert.ok(
            !remainingErrors.some((error) =>
                error.includes('frame-copy artifact')
            ),
            `unexpected frame-copy errors: ${remainingErrors.join('; ')}`
        );

        const linuxResourceDir = join(tempDir, 'linux');
        const linuxNativeDir = join(
            linuxResourceDir,
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        fs.mkdirSync(linuxNativeDir, { recursive: true });
        fs.writeFileSync(join(linuxNativeDir, 'embedded_mpv.node'), '');
        fs.writeFileSync(
            join(linuxNativeDir, 'embedded-mpv-runtime.json'),
            JSON.stringify({
                schemaVersion: 1,
                origin: 'external-mpv-process',
                platform: 'linux',
                arch: 'x64',
                runtimeMode: 'native-view-only',
                frameCopyAvailable: false,
                artifacts: {
                    addon: 'embedded_mpv.node',
                },
                nativeViewFallback: 'process-isolated mpv --wid',
            })
        );

        assert.deepEqual(
            validatePackagedEmbeddedMpv(linuxResourceDir, {
                platform: 'linux',
                required: false,
            }),
            []
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Windows frame-copy packages reject an mpv DLL that exists only under native/lib', () => {
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'iptvnator-mpv-package-'));

    try {
        for (const runtimeFile of [
            'mpv-2.dll',
            'libmpv-2.dll',
            'mpv.dll',
            'libmpv.dll',
        ]) {
            const resourceDir = join(tempDir, runtimeFile);
            const nativeDir = join(
                resourceDir,
                'app.asar.unpacked',
                'electron-backend',
                'native'
            );
            fs.mkdirSync(join(nativeDir, 'lib'), { recursive: true });
            fs.writeFileSync(join(nativeDir, 'embedded_mpv.node'), '');
            fs.writeFileSync(
                join(nativeDir, 'embedded-mpv-runtime.json'),
                JSON.stringify({ origin: 'vendored-lgpl' })
            );
            writeWindowsHelperFixture(
                join(nativeDir, 'iptvnator_mpv_helper.exe'),
                runtimeFile
            );
            fs.writeFileSync(
                join(nativeDir, 'embedded_mpv_frame_reader.node'),
                ''
            );
            fs.writeFileSync(join(nativeDir, 'lib', runtimeFile), '');

            const errors = validatePackagedEmbeddedMpv(resourceDir, {
                platform: 'windows',
                required: true,
            });

            assert.ok(
                errors.some(
                    (error) =>
                        error.includes(
                            'beside the Windows frame-copy helper'
                        ) && error.includes(nativeDir)
                ),
                `${runtimeFile} under native/lib must not satisfy the helper DLL requirement: ${errors.join('; ')}`
            );
        }
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Windows frame-copy packages require the DLL imported by the helper', () => {
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'iptvnator-mpv-package-'));

    try {
        const nativeDir = join(
            tempDir,
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        fs.mkdirSync(nativeDir, { recursive: true });
        fs.writeFileSync(join(nativeDir, 'embedded_mpv.node'), '');
        fs.writeFileSync(
            join(nativeDir, 'embedded-mpv-runtime.json'),
            JSON.stringify({ origin: 'vendored-lgpl' })
        );
        writeWindowsHelperFixture(
            join(nativeDir, 'iptvnator_mpv_helper.exe'),
            'mpv-2.dll'
        );
        fs.writeFileSync(join(nativeDir, 'embedded_mpv_frame_reader.node'), '');
        fs.writeFileSync(join(nativeDir, 'libmpv.dll'), '');

        const errors = validatePackagedEmbeddedMpv(tempDir, {
            platform: 'windows',
            required: true,
        });

        assert.ok(
            errors.some(
                (error) =>
                    error.includes('imports mpv-2.dll') &&
                    error.includes(join(nativeDir, 'mpv-2.dll'))
            ),
            `a different accepted DLL must not satisfy the helper import: ${errors.join('; ')}`
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Windows frame-copy package validation fails closed for a malformed helper', () => {
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'iptvnator-mpv-package-'));

    try {
        const nativeDir = join(
            tempDir,
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        fs.mkdirSync(nativeDir, { recursive: true });
        fs.writeFileSync(join(nativeDir, 'embedded_mpv.node'), '');
        fs.writeFileSync(
            join(nativeDir, 'embedded-mpv-runtime.json'),
            JSON.stringify({ origin: 'vendored-lgpl' })
        );
        fs.writeFileSync(join(nativeDir, 'iptvnator_mpv_helper.exe'), 'MZ');
        fs.writeFileSync(join(nativeDir, 'embedded_mpv_frame_reader.node'), '');
        fs.writeFileSync(join(nativeDir, 'mpv-2.dll'), '');

        const errors = validatePackagedEmbeddedMpv(tempDir, {
            platform: 'windows',
            required: true,
        });

        assert.ok(
            errors.some((error) =>
                error.includes(
                    'Unable to inspect Windows frame-copy helper imports'
                )
            ),
            `malformed helper must fail package validation: ${errors.join('; ')}`
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Windows embedded MPV staging preserves import-library DLL basenames', () => {
    assert.match(
        embeddedMpvStageRuntimeSource,
        /win32:\s*\[\s*'mpv-2\.dll',\s*'libmpv-2\.dll',\s*'mpv\.dll',\s*'libmpv\.dll'\s*\]/
    );
    assert.match(
        embeddedMpvWindowsArchiveStageSource,
        /path\.join\(normalizedPrefix,\s*'bin',\s*path\.basename\(runtimeDll\)\)/
    );
    assert.doesNotMatch(
        embeddedMpvWindowsArchiveStageSource,
        /normalizedWindowsDllName/
    );
    assert.match(embeddedMpvBuildSource, /'libmpv-2\.dll'/);
    assert.match(embeddedMpvPackagingSource, /libmpv-2\.dll/);
});

test('Windows embedded MPV archive staging keeps CI downloads bounded and quiet', () => {
    assert.match(
        embeddedMpvWindowsArchiveStageSource,
        /parsedUrl\.protocol === 'https:'/
    );
    assert.doesNotMatch(
        embeddedMpvWindowsArchiveStageSource,
        /parsedUrl\.protocol === 'http:'/
    );
    assert.match(
        embeddedMpvWindowsArchiveStageSource,
        /fs\.createReadStream\(filePath\)/
    );
    assert.doesNotMatch(
        embeddedMpvWindowsArchiveStageSource,
        /hash\.update\(fs\.readFileSync\(filePath\)\)/
    );
    assert.match(
        embeddedMpvWindowsArchiveStageSource,
        /runResult\(\s*'tar',\s*\['-xf', archivePath, '-C', extractRoot\],\s*\{\s*stdio: 'pipe',\s*\}\s*\)/s
    );
});

test('embedded MPV packaging helpers use a cross-platform module name', () => {
    assert.match(
        electronAfterPackSource,
        /require\(['"]\.\/embedded-mpv-packaging\.cjs['"]\)/
    );
    assert.match(
        packageLayoutVerifier,
        /require\(['"]\.\/embedded-mpv-packaging\.cjs['"]\)/
    );
});

test('frame-copy packaging file operations enforce modes and remove stale artifacts', () => {
    assert.ok(
        fs.existsSync(frameCopyFilesModulePath),
        'shared frame-copy packaging file helper must exist'
    );
    const {
        preparePackagedFrameCopyArtifacts,
        removeStaleFrameCopyArtifacts,
    } = require(frameCopyFilesModulePath);
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'impv-fc-files-'));

    try {
        const helperPath = join(tempDir, 'iptvnator_mpv_helper');
        const windowsHelperPath = join(tempDir, 'iptvnator_mpv_helper.exe');
        const readerPath = join(tempDir, 'embedded_mpv_frame_reader.node');
        fs.writeFileSync(helperPath, '#!/bin/sh\n');
        fs.chmodSync(helperPath, 0o644);
        fs.writeFileSync(windowsHelperPath, 'exe');
        fs.writeFileSync(readerPath, 'reader');

        if (process.platform !== 'win32') {
            preparePackagedFrameCopyArtifacts(tempDir, 'darwin');
            assert.notEqual(
                fs.statSync(helperPath).mode & 0o111,
                0,
                'macOS helper must be executable after packaging'
            );
        }

        preparePackagedFrameCopyArtifacts(tempDir, 'linux');
        assert.equal(
            fs.existsSync(helperPath),
            false,
            'Linux packages must omit the unsupported frame-copy helper'
        );
        assert.equal(
            fs.existsSync(windowsHelperPath),
            false,
            'Linux packages must omit stale Windows frame-copy helpers too'
        );

        fs.writeFileSync(helperPath, '#!/bin/sh\n');
        removeStaleFrameCopyArtifacts(tempDir);
        assert.equal(fs.existsSync(helperPath), false);
        assert.equal(fs.existsSync(windowsHelperPath), false);
        assert.equal(fs.existsSync(readerPath), false);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('Windows CI packages embedded MPV from a staged x64 runtime', () => {
    const requireEmbeddedMpvLines = buildAndMakeWorkflow
        .split(/\r?\n/)
        .filter((line) => line.includes('IPTVNATOR_REQUIRE_EMBEDDED_MPV:'));

    assert.equal(
        packageMetadata.scripts?.['embedded-mpv:stage-runtime:windows-archive'],
        'node tools/embedded-mpv/stage-windows-runtime-archive.mjs'
    );
    assert.match(
        buildAndMakeWorkflow,
        /name:\s+Stage Windows embedded MPV runtime archive/
    );
    assert.match(buildAndMakeWorkflow, /runner:\s+windows-2022/);
    assert.match(
        buildAndMakeWorkflow,
        /IPTVNATOR_WINDOWS_EMBEDDED_MPV_RUNTIME_URL/
    );
    assert.match(
        buildAndMakeWorkflow,
        /IPTVNATOR_WINDOWS_EMBEDDED_MPV_RUNTIME_SHA256/
    );
    assert.match(
        buildAndMakeWorkflow,
        /IPTVNATOR_DEFAULT_WINDOWS_EMBEDDED_MPV_RUNTIME_URL: https:\/\/github\.com\/zhongfly\/mpv-winbuild\/releases\/download\//
    );
    assert.match(buildAndMakeWorkflow, /refs\/tags\/v\*/);
    assert.match(
        buildAndMakeWorkflow,
        /name:\s+Override Windows arch in electron-builder\.json/
    );
    assert.match(
        buildAndMakeWorkflow,
        /IPTVNATOR_REQUIRE_EMBEDDED_MPV:\s+\$\{\{\s*\(matrix\.os == 'linux' \|\| matrix\.os == 'windows'/
    );
    assert.match(embeddedMpvStageRuntimeSource, /\.dll\.a/);
    assert.match(embeddedMpvBuildSource, /\.dll\.a/);
    assert.ok(requireEmbeddedMpvLines.length > 0);
    for (const line of requireEmbeddedMpvLines) {
        assert.doesNotMatch(line, /cache-hit/);
    }
});

test('Windows embedded MPV native build uses wide Win32 cursor resources', () => {
    assert.match(
        embeddedMpvWin32Source,
        /LoadCursorW\(nullptr,\s*MAKEINTRESOURCEW\(32512\)\)/
    );
    assert.doesNotMatch(
        embeddedMpvWin32Source,
        /LoadCursorW\(nullptr,\s*IDC_ARROW\)/
    );
});

test('embedded MPV package validation rejects missing required Windows runtime', () => {
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'iptvnator-mpv-package-'));

    try {
        const nativeDir = join(
            tempDir,
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        fs.mkdirSync(join(nativeDir, 'lib'), { recursive: true });
        fs.writeFileSync(join(nativeDir, 'embedded_mpv.node'), '');
        fs.writeFileSync(
            join(nativeDir, 'embedded-mpv-runtime.json'),
            JSON.stringify({ origin: 'vendored-lgpl' })
        );

        const errors = validatePackagedEmbeddedMpv(tempDir, {
            platform: 'windows',
            required: true,
        });

        assert.match(errors.join('\n'), /Missing bundled embedded MPV runtime/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('embedded MPV package validation rejects bundled Linux libmpv', () => {
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'iptvnator-mpv-package-'));

    try {
        const nativeDir = join(
            tempDir,
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        fs.mkdirSync(join(nativeDir, 'lib'), { recursive: true });
        fs.writeFileSync(join(nativeDir, 'embedded_mpv.node'), '');
        fs.writeFileSync(
            join(nativeDir, 'embedded-mpv-runtime.json'),
            JSON.stringify({ origin: 'external-mpv-process' })
        );
        fs.writeFileSync(join(nativeDir, 'lib', 'libmpv.so'), '');

        const errors = validatePackagedEmbeddedMpv(tempDir, {
            platform: 'linux',
            required: true,
        });

        assert.match(errors.join('\n'), /must not bundle libmpv/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('embedded MPV package validation rejects frame-copy helpers in Linux packages', () => {
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'iptvnator-mpv-package-'));

    try {
        const nativeDir = join(
            tempDir,
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        fs.mkdirSync(nativeDir, { recursive: true });
        fs.writeFileSync(join(nativeDir, 'embedded_mpv.node'), '');
        fs.writeFileSync(
            join(nativeDir, 'embedded-mpv-runtime.json'),
            JSON.stringify({ origin: 'external-mpv-process' })
        );
        fs.writeFileSync(join(nativeDir, 'iptvnator_mpv_helper'), '');
        fs.writeFileSync(join(nativeDir, 'iptvnator_mpv_helper.exe'), '');

        const errors = validatePackagedEmbeddedMpv(tempDir, {
            platform: 'linux',
            required: true,
        });

        const message = errors.join('\n');
        assert.match(message, /must not ship frame-copy helpers/);
        assert.match(message, /iptvnator_mpv_helper\n/);
        assert.match(message, /iptvnator_mpv_helper\.exe/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
