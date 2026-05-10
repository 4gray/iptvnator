import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
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
