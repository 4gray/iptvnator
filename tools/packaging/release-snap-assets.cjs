#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const SOURCE_ARCHIVE_NAME = 'linux-frame-copy-runtime-sources.tar.xz';

function flattenAssetPages(value) {
    if (!Array.isArray(value)) {
        throw new Error('GitHub release assets must be an array.');
    }
    return value.flatMap((entry) =>
        Array.isArray(entry) ? flattenAssetPages(entry) : [entry]
    );
}

function normalizeReleaseAsset(asset) {
    if (
        asset === null ||
        typeof asset !== 'object' ||
        !Number.isSafeInteger(asset.id) ||
        asset.id <= 0 ||
        typeof asset.name !== 'string' ||
        asset.name.length === 0 ||
        asset.name === '.' ||
        asset.name === '..' ||
        asset.name.includes('/') ||
        asset.name.includes('\\') ||
        [...asset.name].some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint <= 0x1f || codePoint === 0x7f;
        })
    ) {
        throw new Error('GitHub release contains an invalid asset record.');
    }
    return {
        id: asset.id,
        name: asset.name,
    };
}

function selectSnapReleaseAssets(assets) {
    const normalized = flattenAssetPages(assets).map(normalizeReleaseAsset);
    const snapAssets = normalized
        .filter(({ name }) => name.endsWith('.snap'))
        .sort(({ name: left }, { name: right }) => left.localeCompare(right));
    if (snapAssets.length === 0) {
        throw new Error(
            'Public release must contain at least one .snap asset.'
        );
    }

    const sourceAssets = normalized.filter(
        ({ name }) => name === SOURCE_ARCHIVE_NAME
    );
    if (sourceAssets.length !== 1) {
        throw new Error(
            `Public release must contain exactly one ${SOURCE_ARCHIVE_NAME} asset.`
        );
    }
    const names = normalized.map(({ name }) => name);
    if (new Set(names).size !== names.length) {
        throw new Error('GitHub release asset names must be unique.');
    }

    return {
        snapAssets,
        sourceAsset: sourceAssets[0],
    };
}

function canonicalSelection(selection) {
    if (
        selection === null ||
        typeof selection !== 'object' ||
        !Array.isArray(selection.snapAssets)
    ) {
        throw new Error('Invalid selected Snap release asset manifest.');
    }
    const canonical = selectSnapReleaseAssets([
        ...selection.snapAssets,
        selection.sourceAsset,
    ]);
    if (!isDeepStrictEqual(selection, canonical)) {
        throw new Error(
            'Selected Snap release asset manifest is not canonical.'
        );
    }
    return canonical;
}

function verifySnapReleaseDownloads(selection, directoryPath) {
    const canonical = canonicalSelection(selection);
    const expectedNames = [
        ...canonical.snapAssets.map(({ name }) => name),
        canonical.sourceAsset.name,
    ].sort();
    try {
        fs.accessSync(directoryPath);
    } catch {
        throw new Error(
            `Missing public release asset directory: ${directoryPath}`
        );
    }
    for (const name of expectedNames) {
        const assetPath = path.join(directoryPath, name);
        let stat;
        try {
            stat = fs.lstatSync(assetPath);
        } catch {
            throw new Error(`Missing or empty public release asset: ${name}`);
        }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
            throw new Error(`Missing or empty public release asset: ${name}`);
        }
    }
    const actualNames = fs.readdirSync(directoryPath).sort();
    if (!isDeepStrictEqual(actualNames, expectedNames)) {
        throw new Error(
            'Downloaded public release assets do not match the exact selected set.'
        );
    }
    return canonical;
}

function parseArguments(argv) {
    const [command, ...tokens] = argv;
    const options = {};
    for (let index = 0; index < tokens.length; index += 2) {
        const name = tokens[index];
        const value = tokens[index + 1];
        if (!name?.startsWith('--') || value === undefined) {
            throw new Error(`Invalid command-line argument: ${name ?? ''}`);
        }
        options[name.slice(2)] = value;
    }
    return { command, options };
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
    const { command, options } = parseArguments(argv);
    if (
        command === 'select' &&
        options['assets-json'] &&
        options['output-json']
    ) {
        writeJson(
            options['output-json'],
            selectSnapReleaseAssets(readJson(options['assets-json']))
        );
        return;
    }
    if (command === 'verify' && options.manifest && options.directory) {
        verifySnapReleaseDownloads(
            readJson(options.manifest),
            options.directory
        );
        return;
    }
    throw new Error(
        'Usage: release-snap-assets.cjs select --assets-json <path> --output-json <path> | verify --manifest <path> --directory <path>'
    );
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = {
    SOURCE_ARCHIVE_NAME,
    selectSnapReleaseAssets,
    verifySnapReleaseDownloads,
};
