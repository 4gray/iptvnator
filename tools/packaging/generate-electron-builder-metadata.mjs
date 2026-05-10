import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const generatedMetadataConfigPath = path.join(
    'apps',
    'electron-backend',
    'src',
    'app',
    'options',
    'electron-builder.metadata.generated.json'
);
export const electronBackendPackageJsonPath = path.join(
    'dist',
    'apps',
    'electron-backend',
    'package.json'
);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function removeUndefinedValues(value) {
    return Object.fromEntries(
        Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
    );
}

function requirePackageField(packageMetadata, fieldName) {
    const value = packageMetadata[fieldName];

    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`Root package.json must define a non-empty ${fieldName}.`);
    }

    return value;
}

export function buildElectronBuilderMetadata(
    packageMetadata,
    electronBuilderConfig = {}
) {
    const extraMetadata = removeUndefinedValues({
        name: requirePackageField(packageMetadata, 'name'),
        productName:
            electronBuilderConfig.productName ??
            electronBuilderConfig.extraMetadata?.productName,
        version: requirePackageField(packageMetadata, 'version'),
        description: packageMetadata.description,
        author: packageMetadata.author,
        homepage: packageMetadata.homepage,
        license: packageMetadata.license,
        main:
            electronBuilderConfig.extraMetadata?.main ??
            'electron-backend/main.js',
    });

    return {
        extends: 'electron-builder.json',
        extraMetadata,
    };
}

export function buildElectronPackageMetadata(
    packageMetadata,
    electronBuilderConfig = {},
    currentElectronPackageMetadata = {}
) {
    return removeUndefinedValues({
        ...currentElectronPackageMetadata,
        ...buildElectronBuilderMetadata(packageMetadata, electronBuilderConfig)
            .extraMetadata,
    });
}

export function writeElectronPackageMetadata({
    workspaceRoot = process.cwd(),
    packageMetadata,
    electronBuilderConfig,
    packageJsonPath = electronBackendPackageJsonPath,
} = {}) {
    const absolutePackageJsonPath = path.join(workspaceRoot, packageJsonPath);

    if (!fs.existsSync(absolutePackageJsonPath)) {
        return {
            outputPath: absolutePackageJsonPath,
            updated: false,
        };
    }

    const currentElectronPackageMetadata = readJson(absolutePackageJsonPath);
    const nextElectronPackageMetadata = buildElectronPackageMetadata(
        packageMetadata,
        electronBuilderConfig,
        currentElectronPackageMetadata
    );

    fs.writeFileSync(
        absolutePackageJsonPath,
        `${JSON.stringify(nextElectronPackageMetadata, null, 2)}\n`
    );

    return {
        outputPath: absolutePackageJsonPath,
        updated: true,
    };
}

export function writeElectronBuilderMetadata({
    workspaceRoot = process.cwd(),
    outputPath = generatedMetadataConfigPath,
} = {}) {
    const packageMetadata = readJson(path.join(workspaceRoot, 'package.json'));
    const electronBuilderConfig = readJson(
        path.join(workspaceRoot, 'electron-builder.json')
    );
    const metadataConfig = buildElectronBuilderMetadata(
        packageMetadata,
        electronBuilderConfig
    );
    const absoluteOutputPath = path.join(workspaceRoot, outputPath);
    const packageMetadataResult = writeElectronPackageMetadata({
        workspaceRoot,
        packageMetadata,
        electronBuilderConfig,
    });

    fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    fs.writeFileSync(
        absoluteOutputPath,
        `${JSON.stringify(metadataConfig, null, 4)}\n`
    );

    return {
        outputPath: absoluteOutputPath,
        metadataConfig,
        packageMetadataResult,
    };
}

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    const { outputPath, packageMetadataResult } = writeElectronBuilderMetadata();
    console.log(`Wrote Electron builder metadata: ${outputPath}`);
    if (packageMetadataResult.updated) {
        console.log(
            `Wrote Electron package metadata: ${packageMetadataResult.outputPath}`
        );
    } else {
        console.log(
            `Skipped Electron package metadata because ${packageMetadataResult.outputPath} does not exist yet.`
        );
    }
}
