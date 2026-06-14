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
            ['windows', join('lib', 'mpv.dll')],
            ['windows', join('lib', 'libmpv.dll')],
        ]) {
            const resourceDir = join(tempDir, platform);
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

            assert.deepEqual(
                validatePackagedEmbeddedMpv(resourceDir, {
                    platform,
                    required: true,
                }),
                []
            );
        }

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
            JSON.stringify({ origin: 'external-mpv-process' })
        );

        assert.deepEqual(
            validatePackagedEmbeddedMpv(linuxResourceDir, {
                platform: 'linux',
                required: true,
            }),
            []
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
