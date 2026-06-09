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
const electronBuilderConfig = JSON.parse(
    fs.readFileSync(
        join(currentDir, '..', '..', 'electron-builder.json'),
        'utf8'
    )
);
const electronProjectConfig = JSON.parse(
    fs.readFileSync(
        join(currentDir, '..', '..', 'apps', 'electron-backend', 'project.json'),
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
const {
    validatePackagedEmbeddedMpv,
} = require('./embedded-mpv-packaging.cjs');

test('Linux package identity does not expose the internal Electron backend project name', () => {
    assert.equal(electronBuilderConfig.productName, 'IPTVnator');
    assert.equal(electronBuilderConfig.extraMetadata?.name, 'iptvnator');
    assert.equal(electronBuilderConfig.extraMetadata?.productName, 'IPTVnator');
    assert.equal(electronBuilderConfig.linux?.executableName, 'iptvnator');
    assert.equal(
        electronBuilderConfig.linux?.desktop?.entry?.StartupWMClass,
        'iptvnator'
    );
});

test('generated Electron package metadata mirrors the root package identity', async () => {
    const {
        buildElectronBuilderMetadata,
        buildElectronPackageMetadata,
    } = await import(
        './generate-electron-builder-metadata.mjs'
    );
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
    const nxElectronExecutorPath = require.resolve(
        'nx-electron/src/executors/package/executor.js'
    );
    const nxElectronExecutor = fs.readFileSync(
        nxElectronExecutorPath,
        'utf8'
    );

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

test('embedded MPV package validation accepts Windows and Linux runtime files', () => {
    const tempDir = fs.mkdtempSync(join(os.tmpdir(), 'iptvnator-mpv-package-'));

    try {
        for (const [platform, runtimeFile] of [
            ['windows', 'mpv-2.dll'],
            ['windows', join('lib', 'mpv.dll')],
            ['linux', join('lib', 'libmpv.so.2')],
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
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
