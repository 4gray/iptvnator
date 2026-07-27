#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const {
    inspectSnapPayload,
    inspectSourceArchive,
    verifySnapReleaseSourceBinding,
} = require('./release-snap-source-binding.cjs');
const {
    SOURCE_ARCHIVE_NAME,
} = require('../embedded-mpv/linux-source-archive-contract.cjs');

const VERIFIED_RELEASE_RECEIPT_NAME = 'verified-release-assets.json';
const VERIFIED_RELEASE_RECEIPT_SCHEMA_VERSION = 1;
const VERIFIED_RELEASE_RECEIPT_MAX_BYTES = 1024 * 1024;
const FILE_COPY_BUFFER_BYTES = 1024 * 1024;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;

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

function regularFileRecord(filePath, asset) {
    const descriptor = fs.openSync(
        filePath,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
    );
    try {
        const initialStat = fs.fstatSync(descriptor);
        if (!initialStat.isFile() || initialStat.size === 0) {
            throw new Error(
                `Verified public release asset is not a non-empty regular file: ${asset.name}`
            );
        }
        const hash = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(FILE_COPY_BUFFER_BYTES);
        let totalBytes = 0;
        for (;;) {
            const bytesRead = fs.readSync(
                descriptor,
                buffer,
                0,
                buffer.length,
                null
            );
            if (bytesRead === 0) {
                break;
            }
            hash.update(buffer.subarray(0, bytesRead));
            totalBytes += bytesRead;
        }
        const finalStat = fs.fstatSync(descriptor);
        if (
            totalBytes !== initialStat.size ||
            finalStat.dev !== initialStat.dev ||
            finalStat.ino !== initialStat.ino ||
            finalStat.size !== initialStat.size ||
            finalStat.mtimeMs !== initialStat.mtimeMs ||
            finalStat.ctimeMs !== initialStat.ctimeMs
        ) {
            throw new Error(
                `Verified public release asset changed while being hashed: ${asset.name}`
            );
        }
        return {
            id: asset.id,
            name: asset.name,
            sha256: hash.digest('hex'),
            size: totalBytes,
        };
    } finally {
        fs.closeSync(descriptor);
    }
}

function copyRegularFileSnapshot(sourcePath, destinationPath, asset) {
    const noFollowFlag = fs.constants.O_NOFOLLOW ?? 0;
    const sourceDescriptor = fs.openSync(
        sourcePath,
        fs.constants.O_RDONLY | noFollowFlag
    );
    let destinationDescriptor;
    try {
        const sourceStat = fs.fstatSync(sourceDescriptor);
        if (!sourceStat.isFile() || sourceStat.size === 0) {
            throw new Error(
                `Downloaded public release asset is not a non-empty regular file: ${asset.name}`
            );
        }
        destinationDescriptor = fs.openSync(
            destinationPath,
            fs.constants.O_WRONLY |
                fs.constants.O_CREAT |
                fs.constants.O_EXCL |
                noFollowFlag,
            0o444
        );
        const hash = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(FILE_COPY_BUFFER_BYTES);
        let totalBytes = 0;
        for (;;) {
            const bytesRead = fs.readSync(
                sourceDescriptor,
                buffer,
                0,
                buffer.length,
                null
            );
            if (bytesRead === 0) {
                break;
            }
            hash.update(buffer.subarray(0, bytesRead));
            let written = 0;
            while (written < bytesRead) {
                written += fs.writeSync(
                    destinationDescriptor,
                    buffer,
                    written,
                    bytesRead - written
                );
            }
            totalBytes += bytesRead;
        }
        const finalSourceStat = fs.fstatSync(sourceDescriptor);
        if (
            totalBytes !== sourceStat.size ||
            finalSourceStat.dev !== sourceStat.dev ||
            finalSourceStat.ino !== sourceStat.ino ||
            finalSourceStat.size !== sourceStat.size ||
            finalSourceStat.mtimeMs !== sourceStat.mtimeMs ||
            finalSourceStat.ctimeMs !== sourceStat.ctimeMs
        ) {
            throw new Error(
                `Downloaded public release asset changed while being snapshotted: ${asset.name}`
            );
        }
        fs.fsyncSync(destinationDescriptor);
        return {
            id: asset.id,
            name: asset.name,
            sha256: hash.digest('hex'),
            size: totalBytes,
        };
    } finally {
        if (destinationDescriptor !== undefined) {
            fs.closeSync(destinationDescriptor);
        }
        fs.closeSync(sourceDescriptor);
    }
}

function snapshotSnapReleaseDownloads(
    selection,
    directoryPath,
    verifiedDirectoryPath
) {
    const canonical = verifySnapReleaseDownloads(selection, directoryPath);
    const outputPath = path.resolve(verifiedDirectoryPath);
    const sourcePath = path.resolve(directoryPath);
    if (
        outputPath === sourcePath ||
        outputPath.startsWith(`${sourcePath}${path.sep}`)
    ) {
        throw new Error(
            'Verified public release asset directory must be separate from downloads.'
        );
    }
    const outputParent = path.dirname(outputPath);
    const outputParentStat = fs.lstatSync(outputParent);
    if (!outputParentStat.isDirectory() || outputParentStat.isSymbolicLink()) {
        throw new Error(
            'Verified public release asset parent must be a real directory.'
        );
    }
    try {
        fs.lstatSync(outputPath);
        throw new Error(
            'Verified public release asset directory must not already exist.'
        );
    } catch (error) {
        if (
            !(
                error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 'ENOENT'
            )
        ) {
            throw error;
        }
    }
    const temporaryPath = fs.mkdtempSync(
        path.join(outputParent, `.${path.basename(outputPath)}-`)
    );
    const assets = [...canonical.snapAssets, canonical.sourceAsset];
    try {
        const records = assets.map((asset) =>
            copyRegularFileSnapshot(
                path.join(sourcePath, asset.name),
                path.join(temporaryPath, asset.name),
                asset
            )
        );
        fs.renameSync(temporaryPath, outputPath);
        return { canonical, records };
    } catch (error) {
        fs.rmSync(temporaryPath, { recursive: true, force: true });
        throw error;
    }
}

function inspectStableReleaseFile(filePath, asset, inspector) {
    const before = regularFileRecord(filePath, asset);
    const inspection = inspector();
    const after = regularFileRecord(filePath, asset);
    if (!isDeepStrictEqual(after, before)) {
        throw new Error(
            `Verified public release asset changed during inspection: ${asset.name}`
        );
    }
    return { inspection, record: after };
}

function writeVerifiedReleaseReceipt(
    verifiedDirectoryPath,
    expectedRepositoryRevision,
    records
) {
    if (
        typeof expectedRepositoryRevision !== 'string' ||
        !GIT_COMMIT_PATTERN.test(expectedRepositoryRevision)
    ) {
        throw new Error(
            'Verified release receipt requires a full repository revision.'
        );
    }
    const receipt = {
        schemaVersion: VERIFIED_RELEASE_RECEIPT_SCHEMA_VERSION,
        repositoryRevision: expectedRepositoryRevision,
        assets: records,
    };
    const receiptPath = path.join(
        verifiedDirectoryPath,
        VERIFIED_RELEASE_RECEIPT_NAME
    );
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o444,
    });
    return receipt;
}

function verifyVerifiedReleaseReceipt(
    selection,
    verifiedDirectoryPath,
    receiptPath,
    expectedRepositoryRevision
) {
    const canonical = canonicalSelection(selection);
    const resolvedDirectory = path.resolve(verifiedDirectoryPath);
    const resolvedReceipt = path.resolve(receiptPath);
    if (
        path.dirname(resolvedReceipt) !== resolvedDirectory ||
        path.basename(resolvedReceipt) !== VERIFIED_RELEASE_RECEIPT_NAME
    ) {
        throw new Error(
            'Verified release receipt must use its canonical asset-directory path.'
        );
    }
    const receiptStat = fs.lstatSync(resolvedReceipt);
    if (
        !receiptStat.isFile() ||
        receiptStat.isSymbolicLink() ||
        receiptStat.size === 0 ||
        receiptStat.size > VERIFIED_RELEASE_RECEIPT_MAX_BYTES
    ) {
        throw new Error(
            'Verified release receipt must be a bounded regular file.'
        );
    }
    let receipt;
    try {
        receipt = JSON.parse(fs.readFileSync(resolvedReceipt, 'utf8'));
    } catch {
        throw new Error('Verified release receipt is not valid JSON.');
    }
    if (
        receipt === null ||
        typeof receipt !== 'object' ||
        !isDeepStrictEqual(Object.keys(receipt).sort(), [
            'assets',
            'repositoryRevision',
            'schemaVersion',
        ]) ||
        receipt.schemaVersion !== VERIFIED_RELEASE_RECEIPT_SCHEMA_VERSION ||
        typeof receipt.repositoryRevision !== 'string' ||
        !GIT_COMMIT_PATTERN.test(receipt.repositoryRevision) ||
        receipt.repositoryRevision !== expectedRepositoryRevision ||
        !Array.isArray(receipt.assets)
    ) {
        throw new Error('Verified release receipt has an invalid contract.');
    }
    const expectedAssets = [...canonical.snapAssets, canonical.sourceAsset];
    if (
        receipt.assets.length !== expectedAssets.length ||
        receipt.assets.some((record, index) => {
            const asset = expectedAssets[index];
            return (
                record === null ||
                typeof record !== 'object' ||
                !isDeepStrictEqual(Object.keys(record).sort(), [
                    'id',
                    'name',
                    'sha256',
                    'size',
                ]) ||
                record.id !== asset.id ||
                record.name !== asset.name ||
                !Number.isSafeInteger(record.size) ||
                record.size <= 0 ||
                typeof record.sha256 !== 'string' ||
                !/^[a-f0-9]{64}$/.test(record.sha256)
            );
        })
    ) {
        throw new Error(
            'Verified release receipt does not match the selected assets.'
        );
    }
    const actualNames = fs.readdirSync(resolvedDirectory).sort();
    const expectedNames = [
        ...expectedAssets.map(({ name }) => name),
        VERIFIED_RELEASE_RECEIPT_NAME,
    ].sort();
    if (!isDeepStrictEqual(actualNames, expectedNames)) {
        throw new Error(
            'Verified release directory does not match its exact receipt.'
        );
    }
    for (const record of receipt.assets) {
        const actual = regularFileRecord(
            path.join(resolvedDirectory, record.name),
            record
        );
        if (!isDeepStrictEqual(actual, record)) {
            throw new Error(
                `Verified release asset no longer matches its receipt: ${record.name}`
            );
        }
    }
    return receipt;
}

function verifySnapReleaseCorrespondence(
    selection,
    directoryPath,
    {
        expectedRepositoryRevision,
        expectedSourceSnapshotSha256,
        inspectSnapPayload: inspectSnap = inspectSnapPayload,
        inspectSourceArchive: inspectSource = inspectSourceArchive,
        validateRuntimeManifest,
        verifiedDirectory,
        verifiedReceiptPath,
    } = {}
) {
    if (verifiedDirectory && verifiedReceiptPath) {
        throw new Error(
            'Release verification cannot create and consume a verified receipt at the same time.'
        );
    }
    let canonical;
    let inspectionDirectory = directoryPath;
    let snapshottedRecords = null;
    let verifiedReceipt = null;
    if (verifiedDirectory) {
        const snapshot = snapshotSnapReleaseDownloads(
            selection,
            directoryPath,
            verifiedDirectory
        );
        canonical = snapshot.canonical;
        snapshottedRecords = snapshot.records;
        inspectionDirectory = path.resolve(verifiedDirectory);
    } else if (verifiedReceiptPath) {
        canonical = canonicalSelection(selection);
        inspectionDirectory = path.resolve(directoryPath);
        verifiedReceipt = verifyVerifiedReleaseReceipt(
            canonical,
            inspectionDirectory,
            verifiedReceiptPath,
            expectedRepositoryRevision
        );
    } else {
        canonical = verifySnapReleaseDownloads(selection, directoryPath);
    }
    try {
        const sourceResult = inspectStableReleaseFile(
            path.join(inspectionDirectory, canonical.sourceAsset.name),
            canonical.sourceAsset,
            () =>
                inspectSource(
                    path.join(inspectionDirectory, canonical.sourceAsset.name),
                    { expectedSourceSnapshotSha256 }
                )
        );
        const snapResults = canonical.snapAssets.map((asset) =>
            inspectStableReleaseFile(
                path.join(inspectionDirectory, asset.name),
                asset,
                () =>
                    inspectSnap(
                        path.join(inspectionDirectory, asset.name),
                        asset
                    )
            )
        );
        verifySnapReleaseSourceBinding(
            {
                expectedRepositoryRevision,
                sourceInspection: sourceResult.inspection,
                snapPayloads: snapResults.map(({ inspection }) => inspection),
            },
            {
                expectedSourceSnapshotSha256,
                validateRuntimeManifest,
            }
        );
        const inspectedRecords = [
            ...snapResults.map(({ record }) => record),
            sourceResult.record,
        ];
        if (verifiedDirectory) {
            if (!isDeepStrictEqual(inspectedRecords, snapshottedRecords)) {
                throw new Error(
                    'Verified release assets changed after their stable snapshot was created.'
                );
            }
            writeVerifiedReleaseReceipt(
                inspectionDirectory,
                expectedRepositoryRevision,
                inspectedRecords
            );
        }
        if (verifiedReceipt) {
            if (!isDeepStrictEqual(inspectedRecords, verifiedReceipt.assets)) {
                throw new Error(
                    'Verified release assets do not match the initially verified receipt after inspection.'
                );
            }
            const reverifiedReceipt = verifyVerifiedReleaseReceipt(
                canonical,
                inspectionDirectory,
                verifiedReceiptPath,
                expectedRepositoryRevision
            );
            if (!isDeepStrictEqual(reverifiedReceipt, verifiedReceipt)) {
                throw new Error(
                    'Verified release receipt changed during full inspection.'
                );
            }
        }
        return canonical;
    } catch (error) {
        if (verifiedDirectory) {
            fs.rmSync(path.resolve(verifiedDirectory), {
                recursive: true,
                force: true,
            });
        }
        throw error;
    }
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
    if (
        command === 'verify' &&
        options.manifest &&
        options.directory &&
        options['repository-revision'] &&
        options['verified-directory']
    ) {
        verifySnapReleaseCorrespondence(
            readJson(options.manifest),
            options.directory,
            {
                expectedRepositoryRevision: options['repository-revision'],
                verifiedDirectory: options['verified-directory'],
            }
        );
        return;
    }
    if (
        command === 'verify-receipt' &&
        options.manifest &&
        options.directory &&
        options.receipt &&
        options['repository-revision']
    ) {
        verifyVerifiedReleaseReceipt(
            readJson(options.manifest),
            options.directory,
            options.receipt,
            options['repository-revision']
        );
        return;
    }
    if (
        command === 'verify-sealed' &&
        options.manifest &&
        options.directory &&
        options.receipt &&
        options['repository-revision']
    ) {
        verifySnapReleaseCorrespondence(
            readJson(options.manifest),
            options.directory,
            {
                expectedRepositoryRevision: options['repository-revision'],
                verifiedReceiptPath: options.receipt,
            }
        );
        return;
    }
    throw new Error(
        `Usage: release-snap-assets.cjs select --assets-json <path> --output-json <path> | verify --manifest <path> --directory <path> --repository-revision <commit> --verified-directory <path> | verify-receipt --manifest <path> --directory <path> --receipt <path> --repository-revision <commit> | verify-sealed --manifest <path> --directory <path> --receipt <path> --repository-revision <commit>`
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
    VERIFIED_RELEASE_RECEIPT_NAME,
    selectSnapReleaseAssets,
    snapshotSnapReleaseDownloads,
    verifyVerifiedReleaseReceipt,
    verifySnapReleaseCorrespondence,
    verifySnapReleaseDownloads,
    verifySnapReleaseSourceBinding,
};
