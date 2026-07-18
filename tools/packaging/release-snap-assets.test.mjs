import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const workspaceRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
);
const helperPath = path.join(
    workspaceRoot,
    'tools',
    'packaging',
    'release-snap-assets.cjs'
);
const sourceBindingHelperPath = path.join(
    workspaceRoot,
    'tools',
    'packaging',
    'release-snap-source-binding.cjs'
);
const sourceArchiveContractPath = path.join(
    workspaceRoot,
    'tools',
    'embedded-mpv',
    'linux-source-archive-contract.cjs'
);
const publishWorkflowPath = path.join(
    workspaceRoot,
    '.github',
    'workflows',
    'publish-snap.yaml'
);

async function loadHelper() {
    return import(pathToFileURL(helperPath).href);
}

async function loadSourceBindingHelper() {
    return import(pathToFileURL(sourceBindingHelperPath).href);
}

async function loadSourceArchiveContract() {
    return import(pathToFileURL(sourceArchiveContractPath).href);
}

function syntheticSquashfsListing() {
    return [
        'drwxr-xr-x 0/0 0 2026-07-18 00:00 squashfs-root',
        '-rw-r--r-- 0/0 1 2026-07-18 00:00 squashfs-root/payload',
        '',
    ].join('\n');
}

function sha256(contents) {
    return crypto.createHash('sha256').update(contents).digest('hex');
}

const SYNTHETIC_LIBPLACEBO_CONTENTS = Buffer.from(
    'libplacebo source snapshot\n'
);
const SYNTHETIC_LIBPLACEBO_ENTRIES = Object.freeze([
    Object.freeze({
        path: 'README.md',
        type: 'file',
        size: SYNTHETIC_LIBPLACEBO_CONTENTS.length,
        executable: false,
        sha256: sha256(SYNTHETIC_LIBPLACEBO_CONTENTS),
    }),
]);
const SYNTHETIC_LIBPLACEBO_SOURCE_SNAPSHOT = (() => {
    const canonical = {
        schemaVersion: 1,
        entryCount: SYNTHETIC_LIBPLACEBO_ENTRIES.length,
        totalBytes: SYNTHETIC_LIBPLACEBO_CONTENTS.length,
        entries: SYNTHETIC_LIBPLACEBO_ENTRIES,
    };
    return Object.freeze({
        schemaVersion: canonical.schemaVersion,
        sha256: sha256(`${JSON.stringify(canonical)}\n`),
        entryCount: canonical.entryCount,
        totalBytes: canonical.totalBytes,
        entries: SYNTHETIC_LIBPLACEBO_ENTRIES,
    });
})();
const EXPECTED_LIBPLACEBO_SOURCE_SUBMODULES = Object.freeze([
    '450bd2232225d6c7728a4108055ac2e37cef6475 3rdparty/Vulkan-Headers (v1.4.337)',
    '97b54ca9e75f5303507699d27c6b4f4efe4641a1 3rdparty/fast_float (v6.1.0-275-g97b54ca)',
    '73db193f853e2ee079bf3ca8a64aa2eaf6459043 3rdparty/glad (v0.1.11a-302-g73db193)',
    '15206881c006c79667fe5154fe80c01c65410679 3rdparty/jinja (3.1.6)',
    '297fc8e356e6836a62087949245d09a28e9f1b13 3rdparty/markupsafe (3.0.3)',
    '242f35efa067a46c595645eeda7b1771ea1f83b1 demos/3rdparty/nuklear (4.12.8)',
]);

function sourcePackageIdentity(sourcePackage) {
    return Object.fromEntries(
        [
            'version',
            'sourceUrl',
            'sourceTag',
            'sourceSha256',
            'sourceGitCommit',
            'license',
        ]
            .filter((field) => Object.hasOwn(sourcePackage, field))
            .map((field) => [field, sourcePackage[field]])
    );
}

function createComplianceInspection(sourceRuntime) {
    const licenseInputFiles = [];
    const noticeLicenseFiles = [];
    const licenseInputPackages = [];
    const noticePackages = [];
    for (const [id, sourcePackage] of Object.entries(sourceRuntime.packages)) {
        const contents = Buffer.from(`${id} license\n`);
        const file = {
            path: `licenses/${id}/LICENSE`,
            size: contents.length,
            sha256: sha256(contents),
        };
        licenseInputFiles.push(file);
        noticeLicenseFiles.push(file);
        licenseInputPackages.push({
            id,
            ...sourcePackageIdentity(sourcePackage),
            files: [
                {
                    sourcePath: 'LICENSE',
                    ...file,
                },
            ],
        });
        noticePackages.push({
            id,
            ...sourcePackageIdentity(sourcePackage),
            files: [file],
        });
    }
    const aggregateNoticeContents = Buffer.from('third-party notices\n');
    const noticeFile = {
        path: 'THIRD_PARTY_NOTICES.txt',
        size: aggregateNoticeContents.length,
        sha256: sha256(aggregateNoticeContents),
    };
    return {
        aggregateNoticeContents,
        libplaceboSourceSnapshot: SYNTHETIC_LIBPLACEBO_SOURCE_SNAPSHOT,
        licenseInputFiles,
        licenseInputs: {
            schemaVersion: 1,
            origin: 'pinned-linux-runtime-license-inputs',
            platform: 'linux',
            arch: 'x64',
            packages: licenseInputPackages,
        },
        noticeFile,
        noticeLicenseFiles,
        notices: {
            schemaVersion: 1,
            origin: 'pinned-linux-runtime-upstream-licenses',
            platform: 'linux',
            arch: 'x64',
            noticeFile,
            packages: noticePackages,
            totalBytes:
                noticeFile.size +
                noticeLicenseFiles.reduce(
                    (total, file) => total + file.size,
                    0
                ),
        },
        toolingValidated: true,
    };
}

function createSourceBindingFixture() {
    const repositoryRevision = 'a'.repeat(40);
    const archiveSha256 = 'b'.repeat(64);
    const sourceRuntime = {
        generatedAt: '2026-07-18T00:00:00.000Z',
        packages: {
            ffmpeg: {
                version: '1.0.0',
                sourceUrl: 'https://example.test/ffmpeg.tar.xz',
                sourceSha256: archiveSha256,
                license: 'LGPL-2.1-or-later',
            },
            libplacebo: {
                version: '2.0.0',
                sourceUrl: 'https://example.test/libplacebo.git',
                sourceTag: 'v2.0.0',
                sourceGitCommit: 'c'.repeat(40),
                sourceSubmodules: [...EXPECTED_LIBPLACEBO_SOURCE_SUBMODULES],
                license: 'LGPL-2.1-or-later',
            },
        },
    };
    const compliance = createComplianceInspection(sourceRuntime);
    const sourceCompliance = { ...compliance };
    delete sourceCompliance.aggregateNoticeContents;
    const sourceIndex = {
        schemaVersion: 3,
        repositoryRevision,
        sourcePackages: sourceRuntime.packages,
        archives: [
            {
                name: 'ffmpeg.tar.xz',
                sha256: archiveSha256,
            },
        ],
        libplacebo: {
            sourceGitCommit: sourceRuntime.packages.libplacebo.sourceGitCommit,
            sourceSubmodules: [...EXPECTED_LIBPLACEBO_SOURCE_SUBMODULES],
            sourceSnapshot: SYNTHETIC_LIBPLACEBO_SOURCE_SNAPSHOT,
        },
        legal: {
            manifest: 'notices/embedded-mpv-notices.json',
            noticeFile: compliance.notices.noticeFile,
            packages: compliance.notices.packages,
        },
    };
    const sourceInspection = {
        archiveSha256: 'd'.repeat(64),
        sourceRuntime,
        sourceIndex,
        repositoryRevision,
        localChanges: Buffer.alloc(0),
        archiveFiles: sourceIndex.archives,
        compliance: sourceCompliance,
    };
    const snapPayloads = {
        'IPTVnator-amd64.snap': {
            assetName: 'IPTVnator-amd64.snap',
            architecture: 'x64',
            markerOnly: false,
            manifest: {
                platform: 'linux',
                arch: 'x64',
                profile: 'portable',
                runtimeMode: 'bundled',
                targets: ['appimage', 'snap'],
                sourceArchive: {
                    schemaVersion: 1,
                    name: 'linux-frame-copy-runtime-sources.tar.xz',
                    sha256: 'd'.repeat(64),
                    repositoryRevision,
                },
                sourceRuntime,
            },
        },
        'IPTVnator-arm64.snap': {
            assetName: 'IPTVnator-arm64.snap',
            architecture: 'arm64',
            markerOnly: true,
            manifest: null,
        },
    };
    return {
        expectedSourceSnapshotSha256:
            SYNTHETIC_LIBPLACEBO_SOURCE_SNAPSHOT.sha256,
        repositoryRevision,
        sourceInspection,
        snapPayloads,
    };
}

test('binds source metadata and checksums to every selected Snap before publication', async (t) => {
    const helper = await loadHelper();
    const fixture = createSourceBindingFixture();
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-snap-source-binding-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const selection = {
        snapAssets: [
            { id: 1, name: 'IPTVnator-amd64.snap' },
            { id: 2, name: 'IPTVnator-arm64.snap' },
        ],
        sourceAsset: {
            id: 3,
            name: 'linux-frame-copy-runtime-sources.tar.xz',
        },
    };
    for (const name of [
        ...selection.snapAssets.map(({ name }) => name),
        selection.sourceAsset.name,
    ]) {
        fs.writeFileSync(path.join(temporaryRoot, name), name);
    }
    const inspectedSnaps = [];

    assert.deepEqual(
        helper.verifySnapReleaseCorrespondence(selection, temporaryRoot, {
            expectedRepositoryRevision: fixture.repositoryRevision,
            expectedSourceSnapshotSha256: fixture.expectedSourceSnapshotSha256,
            inspectSourceArchive: () => fixture.sourceInspection,
            inspectSnapPayload: (_snapPath, asset) => {
                inspectedSnaps.push(asset.name);
                return fixture.snapPayloads[asset.name];
            },
            validateRuntimeManifest: () => [],
        }),
        selection
    );
    assert.deepEqual(
        inspectedSnaps,
        selection.snapAssets.map(({ name }) => name)
    );
});

test('publishes only a stable verified asset snapshot with an exact receipt', async (t) => {
    const helper = await loadHelper();
    const fixture = createSourceBindingFixture();
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-snap-release-snapshot-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const downloadRoot = path.join(temporaryRoot, 'downloads');
    const verifiedRoot = path.join(temporaryRoot, 'verified');
    fs.mkdirSync(downloadRoot);
    const selection = {
        snapAssets: [
            { id: 1, name: 'IPTVnator-amd64.snap' },
            { id: 2, name: 'IPTVnator-arm64.snap' },
        ],
        sourceAsset: {
            id: 3,
            name: 'linux-frame-copy-runtime-sources.tar.xz',
        },
    };
    for (const name of [
        ...selection.snapAssets.map(({ name }) => name),
        selection.sourceAsset.name,
    ]) {
        fs.writeFileSync(path.join(downloadRoot, name), name);
    }
    const inspectedPaths = [];
    assert.deepEqual(
        helper.verifySnapReleaseCorrespondence(selection, downloadRoot, {
            expectedRepositoryRevision: fixture.repositoryRevision,
            expectedSourceSnapshotSha256: fixture.expectedSourceSnapshotSha256,
            inspectSourceArchive: (sourcePath) => {
                inspectedPaths.push(sourcePath);
                return fixture.sourceInspection;
            },
            inspectSnapPayload: (snapPath, asset) => {
                inspectedPaths.push(snapPath);
                return fixture.snapPayloads[asset.name];
            },
            validateRuntimeManifest: () => [],
            verifiedDirectory: verifiedRoot,
        }),
        selection
    );
    assert.ok(
        inspectedPaths.every((filePath) =>
            filePath.startsWith(`${verifiedRoot}${path.sep}`)
        )
    );
    const receiptPath = path.join(
        verifiedRoot,
        helper.VERIFIED_RELEASE_RECEIPT_NAME
    );
    const receipt = helper.verifyVerifiedReleaseReceipt(
        selection,
        verifiedRoot,
        receiptPath,
        fixture.repositoryRevision
    );
    assert.equal(receipt.repositoryRevision, fixture.repositoryRevision);
    assert.deepEqual(
        receipt.assets.map(({ name }) => name),
        [
            ...selection.snapAssets.map(({ name }) => name),
            selection.sourceAsset.name,
        ]
    );
    const sealedInspectionPaths = [];
    assert.deepEqual(
        helper.verifySnapReleaseCorrespondence(selection, verifiedRoot, {
            expectedRepositoryRevision: fixture.repositoryRevision,
            expectedSourceSnapshotSha256: fixture.expectedSourceSnapshotSha256,
            inspectSourceArchive: (sourcePath) => {
                sealedInspectionPaths.push(sourcePath);
                return fixture.sourceInspection;
            },
            inspectSnapPayload: (snapPath, asset) => {
                sealedInspectionPaths.push(snapPath);
                return fixture.snapPayloads[asset.name];
            },
            validateRuntimeManifest: () => [],
            verifiedReceiptPath: receiptPath,
        }),
        selection
    );
    assert.ok(
        sealedInspectionPaths.every((filePath) =>
            filePath.startsWith(`${verifiedRoot}${path.sep}`)
        )
    );
    assert.throws(
        () =>
            helper.verifyVerifiedReleaseReceipt(
                selection,
                verifiedRoot,
                receiptPath,
                'f'.repeat(40)
            ),
        /invalid contract/i
    );

    const changedSnapPath = path.join(
        verifiedRoot,
        selection.snapAssets[0].name
    );
    fs.chmodSync(changedSnapPath, 0o644);
    fs.appendFileSync(changedSnapPath, 'changed');
    assert.throws(
        () =>
            helper.verifyVerifiedReleaseReceipt(
                selection,
                verifiedRoot,
                receiptPath,
                fixture.repositoryRevision
            ),
        /no longer matches its receipt/i
    );
});

test('binds sealed inspection to the initially verified receipt across a mutually consistent replacement', async (t) => {
    const helper = await loadHelper();
    const fixture = createSourceBindingFixture();
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-snap-release-replacement-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const downloadRoot = path.join(temporaryRoot, 'downloads');
    const verifiedRoot = path.join(temporaryRoot, 'verified');
    const replacementRoot = path.join(temporaryRoot, 'replacement');
    const originalRoot = path.join(temporaryRoot, 'original');
    fs.mkdirSync(downloadRoot);
    fs.mkdirSync(replacementRoot);
    const selection = {
        snapAssets: [{ id: 1, name: 'IPTVnator-amd64.snap' }],
        sourceAsset: {
            id: 2,
            name: 'linux-frame-copy-runtime-sources.tar.xz',
        },
    };
    for (const name of [
        selection.snapAssets[0].name,
        selection.sourceAsset.name,
    ]) {
        fs.writeFileSync(path.join(downloadRoot, name), name);
    }
    helper.verifySnapReleaseCorrespondence(selection, downloadRoot, {
        expectedRepositoryRevision: fixture.repositoryRevision,
        expectedSourceSnapshotSha256: fixture.expectedSourceSnapshotSha256,
        inspectSourceArchive: () => fixture.sourceInspection,
        inspectSnapPayload: (_snapPath, asset) =>
            fixture.snapPayloads[asset.name],
        validateRuntimeManifest: () => [],
        verifiedDirectory: verifiedRoot,
    });

    const replacementSnapContents = Buffer.from('replacement Snap payload');
    const sourceContents = fs.readFileSync(
        path.join(verifiedRoot, selection.sourceAsset.name)
    );
    fs.writeFileSync(
        path.join(replacementRoot, selection.snapAssets[0].name),
        replacementSnapContents
    );
    fs.writeFileSync(
        path.join(replacementRoot, selection.sourceAsset.name),
        sourceContents
    );
    const replacementRecords = [
        {
            ...selection.snapAssets[0],
            sha256: sha256(replacementSnapContents),
            size: replacementSnapContents.length,
        },
        {
            ...selection.sourceAsset,
            sha256: sha256(sourceContents),
            size: sourceContents.length,
        },
    ];
    const replacementReceiptPath = path.join(
        replacementRoot,
        helper.VERIFIED_RELEASE_RECEIPT_NAME
    );
    fs.writeFileSync(
        replacementReceiptPath,
        `${JSON.stringify(
            {
                schemaVersion: 1,
                repositoryRevision: fixture.repositoryRevision,
                assets: replacementRecords,
            },
            null,
            2
        )}\n`
    );
    assert.deepEqual(
        helper.verifyVerifiedReleaseReceipt(
            selection,
            replacementRoot,
            replacementReceiptPath,
            fixture.repositoryRevision
        ).assets,
        replacementRecords
    );
    const receiptPath = path.join(
        verifiedRoot,
        helper.VERIFIED_RELEASE_RECEIPT_NAME
    );
    let replaced = false;

    assert.throws(
        () =>
            helper.verifySnapReleaseCorrespondence(selection, verifiedRoot, {
                expectedRepositoryRevision: fixture.repositoryRevision,
                expectedSourceSnapshotSha256:
                    fixture.expectedSourceSnapshotSha256,
                inspectSourceArchive: () => {
                    fs.renameSync(verifiedRoot, originalRoot);
                    fs.renameSync(replacementRoot, verifiedRoot);
                    replaced = true;
                    return fixture.sourceInspection;
                },
                inspectSnapPayload: (_snapPath, asset) =>
                    fixture.snapPayloads[asset.name],
                validateRuntimeManifest: () => [],
                verifiedReceiptPath: receiptPath,
            }),
        /initially verified receipt/i
    );
    assert.equal(replaced, true);
});

test('removes a verified snapshot when an asset changes during inspection', async (t) => {
    const helper = await loadHelper();
    const fixture = createSourceBindingFixture();
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-snap-release-race-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
    const downloadRoot = path.join(temporaryRoot, 'downloads');
    const verifiedRoot = path.join(temporaryRoot, 'verified');
    fs.mkdirSync(downloadRoot);
    const selection = {
        snapAssets: [{ id: 1, name: 'IPTVnator-amd64.snap' }],
        sourceAsset: {
            id: 2,
            name: 'linux-frame-copy-runtime-sources.tar.xz',
        },
    };
    for (const name of [
        selection.snapAssets[0].name,
        selection.sourceAsset.name,
    ]) {
        fs.writeFileSync(path.join(downloadRoot, name), name);
    }

    assert.throws(
        () =>
            helper.verifySnapReleaseCorrespondence(selection, downloadRoot, {
                expectedRepositoryRevision: fixture.repositoryRevision,
                expectedSourceSnapshotSha256:
                    fixture.expectedSourceSnapshotSha256,
                inspectSourceArchive: (sourcePath) => {
                    fs.chmodSync(sourcePath, 0o644);
                    fs.appendFileSync(sourcePath, 'changed');
                    return fixture.sourceInspection;
                },
                inspectSnapPayload: (_snapPath, asset) =>
                    fixture.snapPayloads[asset.name],
                validateRuntimeManifest: () => [],
                verifiedDirectory: verifiedRoot,
            }),
        /changed during inspection/i
    );
    assert.equal(fs.existsSync(verifiedRoot), false);
});

test('fails closed for stale source identity, archive bytes, and x64 marker-only payloads', async () => {
    const helper = await loadHelper();
    const fixture = createSourceBindingFixture();
    const validateRuntimeManifest = () => [];

    const staleRevision = structuredClone(fixture.sourceInspection);
    staleRevision.sourceIndex.repositoryRevision = 'e'.repeat(40);
    assert.throws(
        () =>
            helper.verifySnapReleaseSourceBinding(
                {
                    expectedRepositoryRevision: fixture.repositoryRevision,
                    sourceInspection: staleRevision,
                    snapPayloads: Object.values(fixture.snapPayloads),
                },
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                    validateRuntimeManifest,
                }
            ),
        /repository revision/i
    );

    const forgedSubmodules = structuredClone(fixture);
    const forgedSubmoduleRecord = `${'f'.repeat(40)} 3rdparty/Vulkan-Headers (v1.4.337)`;
    forgedSubmodules.sourceInspection.sourceRuntime.packages.libplacebo.sourceSubmodules[0] =
        forgedSubmoduleRecord;
    forgedSubmodules.sourceInspection.sourceIndex.libplacebo.sourceSubmodules[0] =
        forgedSubmoduleRecord;
    forgedSubmodules.sourceInspection.sourceIndex.sourcePackages =
        forgedSubmodules.sourceInspection.sourceRuntime.packages;
    forgedSubmodules.snapPayloads[
        'IPTVnator-amd64.snap'
    ].manifest.sourceRuntime = forgedSubmodules.sourceInspection.sourceRuntime;
    assert.throws(
        () =>
            helper.verifySnapReleaseSourceBinding(
                {
                    expectedRepositoryRevision: fixture.repositoryRevision,
                    sourceInspection: forgedSubmodules.sourceInspection,
                    snapPayloads: Object.values(forgedSubmodules.snapPayloads),
                },
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                    validateRuntimeManifest,
                }
            ),
        /submodule/i
    );

    const tamperedArchive = structuredClone(fixture.sourceInspection);
    tamperedArchive.archiveFiles[0].sha256 = 'f'.repeat(64);
    assert.throws(
        () =>
            helper.verifySnapReleaseSourceBinding(
                {
                    expectedRepositoryRevision: fixture.repositoryRevision,
                    sourceInspection: tamperedArchive,
                    snapPayloads: Object.values(fixture.snapPayloads),
                },
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                    validateRuntimeManifest,
                }
            ),
        /archive.*checksum/i
    );

    const staleSnapPayloads = structuredClone(fixture.snapPayloads);
    staleSnapPayloads[
        'IPTVnator-amd64.snap'
    ].manifest.sourceRuntime.generatedAt = '2025-01-01T00:00:00.000Z';
    assert.throws(
        () =>
            helper.verifySnapReleaseSourceBinding(
                {
                    expectedRepositoryRevision: fixture.repositoryRevision,
                    sourceInspection: fixture.sourceInspection,
                    snapPayloads: Object.values(staleSnapPayloads),
                },
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                    validateRuntimeManifest,
                }
            ),
        /Snap source runtime.*source archive/i
    );

    const markerOnlyX64 = structuredClone(fixture.snapPayloads);
    markerOnlyX64['IPTVnator-amd64.snap'] = {
        assetName: 'IPTVnator-amd64.snap',
        architecture: 'x64',
        markerOnly: true,
        manifest: null,
    };
    assert.throws(
        () =>
            helper.verifySnapReleaseSourceBinding(
                {
                    expectedRepositoryRevision: fixture.repositoryRevision,
                    sourceInspection: fixture.sourceInspection,
                    snapPayloads: Object.values(markerOnlyX64),
                },
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                    validateRuntimeManifest,
                }
            ),
        /x64 Snap.*frame-copy/i
    );

    const incompleteCompliance = structuredClone(fixture.sourceInspection);
    incompleteCompliance.compliance.toolingValidated = false;
    assert.throws(
        () =>
            helper.verifySnapReleaseSourceBinding(
                {
                    expectedRepositoryRevision: fixture.repositoryRevision,
                    sourceInspection: incompleteCompliance,
                    snapPayloads: Object.values(fixture.snapPayloads),
                },
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                    validateRuntimeManifest,
                }
            ),
        /source archive compliance/i
    );

    assert.throws(
        () =>
            helper.verifySnapReleaseSourceBinding(
                {
                    expectedRepositoryRevision: fixture.repositoryRevision,
                    sourceInspection: fixture.sourceInspection,
                    snapPayloads: [
                        fixture.snapPayloads['IPTVnator-arm64.snap'],
                    ],
                },
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                    validateRuntimeManifest,
                }
            ),
        /exactly one x64 Snap/i
    );

    assert.throws(
        () =>
            helper.verifySnapReleaseSourceBinding(
                {
                    expectedRepositoryRevision: fixture.repositoryRevision,
                    sourceInspection: fixture.sourceInspection,
                    snapPayloads: [
                        fixture.snapPayloads['IPTVnator-amd64.snap'],
                        {
                            ...fixture.snapPayloads['IPTVnator-amd64.snap'],
                            assetName: 'IPTVnator-second-amd64.snap',
                        },
                    ],
                },
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                    validateRuntimeManifest,
                }
            ),
        /exactly one x64 Snap/i
    );
});

test('hashes the final source archive bytes and reads the exact packaged Snap binding', async (t) => {
    const sourceBindingHelper = await loadSourceBindingHelper();
    const sourceArchiveContract = await loadSourceArchiveContract();
    const fixture = createSourceBindingFixture();
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-snap-source-inspection-')
    );
    t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

    const sourceRoot = path.join(temporaryRoot, 'source');
    const metadataRoot = path.join(sourceRoot, 'metadata');
    const archivesRoot = path.join(sourceRoot, 'archives');
    fs.mkdirSync(metadataRoot, { recursive: true });
    fs.mkdirSync(archivesRoot, { recursive: true });
    const pinnedSourceContents = Buffer.from('pinned ffmpeg source');
    const pinnedSourceSha256 = crypto
        .createHash('sha256')
        .update(pinnedSourceContents)
        .digest('hex');
    const sourceRuntime = structuredClone(
        fixture.sourceInspection.sourceRuntime
    );
    sourceRuntime.packages.ffmpeg.sourceSha256 = pinnedSourceSha256;
    const sourceIndex = structuredClone(fixture.sourceInspection.sourceIndex);
    sourceIndex.sourcePackages = sourceRuntime.packages;
    sourceIndex.archives = [
        {
            name: 'ffmpeg.tar.xz',
            sha256: pinnedSourceSha256,
        },
    ];
    sourceIndex.libplacebo = {
        sourceGitCommit: sourceRuntime.packages.libplacebo.sourceGitCommit,
        sourceSubmodules: [
            ...sourceRuntime.packages.libplacebo.sourceSubmodules,
        ],
        sourceSnapshot: SYNTHETIC_LIBPLACEBO_SOURCE_SNAPSHOT,
    };
    const compliance = createComplianceInspection(sourceRuntime);
    sourceIndex.legal = {
        manifest: 'notices/embedded-mpv-notices.json',
        noticeFile: compliance.notices.noticeFile,
        packages: compliance.notices.packages,
    };
    fs.writeFileSync(
        path.join(archivesRoot, 'ffmpeg.tar.xz'),
        pinnedSourceContents
    );
    const licenseInputRoot = path.join(sourceRoot, 'license-inputs');
    const noticesRoot = path.join(sourceRoot, 'notices');
    for (const [root, files] of [
        [licenseInputRoot, compliance.licenseInputFiles],
        [noticesRoot, compliance.noticeLicenseFiles],
    ]) {
        for (const file of files) {
            const filePath = path.join(root, ...file.path.split('/'));
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, `${file.path.split('/')[1]} license\n`);
        }
    }
    fs.writeFileSync(
        path.join(licenseInputRoot, 'linux-runtime-license-inputs.json'),
        `${JSON.stringify(compliance.licenseInputs)}\n`
    );
    fs.writeFileSync(
        path.join(noticesRoot, 'embedded-mpv-notices.json'),
        `${JSON.stringify(compliance.notices)}\n`
    );
    fs.writeFileSync(
        path.join(noticesRoot, 'THIRD_PARTY_NOTICES.txt'),
        compliance.aggregateNoticeContents
    );
    const libplaceboRoot = path.join(sourceRoot, 'git', 'libplacebo');
    fs.mkdirSync(libplaceboRoot, { recursive: true });
    fs.writeFileSync(
        path.join(libplaceboRoot, 'README.md'),
        'libplacebo source snapshot\n'
    );
    const toolingFiles = [
        ['embedded-mpv', 'build-linux-runtime.cjs'],
        ['embedded-mpv', 'build-linux-runtime.mjs'],
        ['embedded-mpv', 'generate-linux-runtime-notices.cjs'],
        ['embedded-mpv', 'linux-runtime-manifest.cjs'],
        ['embedded-mpv', 'linux-source-archive-contract.cjs'],
        ['embedded-mpv', 'stage-runtime.mjs'],
        ['packaging', 'prepare-linux-runtime-source-snapshot.cjs'],
    ];
    const toolingRoot = path.join(sourceRoot, 'tooling');
    fs.mkdirSync(toolingRoot, { recursive: true });
    for (const [directoryName, fileName] of toolingFiles) {
        fs.copyFileSync(
            path.join(workspaceRoot, 'tools', directoryName, fileName),
            path.join(toolingRoot, fileName)
        );
    }
    fs.writeFileSync(
        path.join(metadataRoot, 'runtime-manifest.json'),
        `${JSON.stringify(sourceRuntime)}\n`
    );
    fs.writeFileSync(
        path.join(metadataRoot, 'source-index.json'),
        `${JSON.stringify(sourceIndex)}\n`
    );
    fs.writeFileSync(
        path.join(metadataRoot, 'iptvnator-git-revision.txt'),
        `${fixture.repositoryRevision}\n`
    );
    fs.writeFileSync(path.join(metadataRoot, 'local-changes.patch'), '');
    const archiveChecksumsPath = path.join(metadataRoot, 'archive-sha256.txt');
    fs.writeFileSync(
        archiveChecksumsPath,
        `${pinnedSourceSha256}  ffmpeg.tar.xz\n`
    );

    const sourceArchivePath = path.join(
        temporaryRoot,
        'linux-frame-copy-runtime-sources.tar.xz'
    );
    const tarResult = childProcess.spawnSync(
        'tar',
        [
            '--create',
            '--xz',
            '--file',
            sourceArchivePath,
            '--directory',
            sourceRoot,
            '.',
        ],
        { encoding: 'utf8' }
    );
    assert.equal(tarResult.error, undefined);
    assert.equal(tarResult.status, 0, tarResult.stderr);

    const sourceArchive = sourceArchiveContract.createLinuxSourceArchiveBinding(
        {
            archivePath: sourceArchivePath,
            repositoryRevision: fixture.repositoryRevision,
        }
    );
    assert.throws(
        () => sourceBindingHelper.inspectSourceArchive(sourceArchivePath),
        /snapshot digest mismatch/i
    );
    const sourceInspection = sourceBindingHelper.inspectSourceArchive(
        sourceArchivePath,
        {
            expectedSourceSnapshotSha256: fixture.expectedSourceSnapshotSha256,
        }
    );
    assert.equal(sourceInspection.archiveSha256, sourceArchive.sha256);
    assert.deepEqual(sourceInspection.archiveFiles, sourceIndex.archives);

    const hiddenSourceRoot = path.join(temporaryRoot, 'hidden-source');
    fs.mkdirSync(hiddenSourceRoot);
    fs.writeFileSync(
        path.join(hiddenSourceRoot, 'undeclared-hidden-source.txt'),
        'not part of the canonical source bundle'
    );
    const hiddenSourceArchivePath = path.join(
        temporaryRoot,
        'hidden-source.tar.xz'
    );
    const hiddenSourceTarResult = childProcess.spawnSync(
        'tar',
        [
            '--create',
            '--xz',
            '--file',
            hiddenSourceArchivePath,
            '--directory',
            hiddenSourceRoot,
            '.',
        ],
        { encoding: 'utf8' }
    );
    assert.equal(hiddenSourceTarResult.error, undefined);
    assert.equal(hiddenSourceTarResult.status, 0, hiddenSourceTarResult.stderr);
    const concatenatedSourceArchivePath = path.join(
        temporaryRoot,
        'concatenated-source.tar.xz'
    );
    fs.writeFileSync(
        concatenatedSourceArchivePath,
        Buffer.concat([
            fs.readFileSync(sourceArchivePath),
            fs.readFileSync(hiddenSourceArchivePath),
        ])
    );
    assert.throws(
        () =>
            sourceBindingHelper.inspectSourceArchive(
                concatenatedSourceArchivePath,
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                }
            ),
        /undeclared source archive member/i
    );

    fs.writeFileSync(
        archiveChecksumsPath,
        `${'0'.repeat(64)}  ffmpeg.tar.xz\n`
    );
    const badChecksumArchivePath = path.join(
        temporaryRoot,
        'bad-checksum-source.tar.xz'
    );
    const badChecksumTarResult = childProcess.spawnSync(
        'tar',
        [
            '--create',
            '--xz',
            '--file',
            badChecksumArchivePath,
            '--directory',
            sourceRoot,
            '.',
        ],
        { encoding: 'utf8' }
    );
    assert.equal(badChecksumTarResult.error, undefined);
    assert.equal(badChecksumTarResult.status, 0, badChecksumTarResult.stderr);
    assert.throws(
        () =>
            sourceBindingHelper.inspectSourceArchive(badChecksumArchivePath, {
                expectedSourceSnapshotSha256:
                    fixture.expectedSourceSnapshotSha256,
            }),
        /archive checksum/i
    );
    fs.writeFileSync(
        archiveChecksumsPath,
        `${pinnedSourceSha256}  ffmpeg.tar.xz\n`
    );

    const extraSourcePath = path.join(sourceRoot, 'undeclared-source.txt');
    fs.writeFileSync(
        extraSourcePath,
        'not part of the canonical source bundle'
    );
    const extraMemberArchivePath = path.join(
        temporaryRoot,
        'extra-member-source.tar.xz'
    );
    const extraMemberTarResult = childProcess.spawnSync(
        'tar',
        [
            '--create',
            '--xz',
            '--file',
            extraMemberArchivePath,
            '--directory',
            sourceRoot,
            '.',
        ],
        { encoding: 'utf8' }
    );
    assert.equal(extraMemberTarResult.error, undefined);
    assert.equal(extraMemberTarResult.status, 0, extraMemberTarResult.stderr);
    assert.throws(
        () =>
            sourceBindingHelper.inspectSourceArchive(extraMemberArchivePath, {
                expectedSourceSnapshotSha256:
                    fixture.expectedSourceSnapshotSha256,
            }),
        /undeclared source archive member/i
    );
    fs.unlinkSync(extraSourcePath);

    const oversizedSourceArchive = path.join(
        temporaryRoot,
        'oversized-source.tar.xz'
    );
    fs.writeFileSync(oversizedSourceArchive, '');
    fs.truncateSync(oversizedSourceArchive, 1024 * 1024 * 1024 + 1);
    assert.throws(
        () => sourceBindingHelper.inspectSourceArchive(oversizedSourceArchive),
        /bounded non-empty regular file/i
    );

    const localChangesPath = path.join(metadataRoot, 'local-changes.patch');
    const emptyTargetPath = path.join(sourceRoot, 'empty-target');
    fs.writeFileSync(emptyTargetPath, '');
    fs.unlinkSync(localChangesPath);
    fs.symlinkSync('../empty-target', localChangesPath);
    const symlinkArchivePath = path.join(
        temporaryRoot,
        'symlinked-source.tar.xz'
    );
    const symlinkTarResult = childProcess.spawnSync(
        'tar',
        [
            '--create',
            '--xz',
            '--file',
            symlinkArchivePath,
            '--directory',
            sourceRoot,
            '.',
        ],
        { encoding: 'utf8' }
    );
    assert.equal(symlinkTarResult.error, undefined);
    assert.equal(symlinkTarResult.status, 0, symlinkTarResult.stderr);
    assert.throws(
        () => sourceBindingHelper.inspectSourceArchive(symlinkArchivePath),
        /required member.*regular file/i
    );
    fs.unlinkSync(localChangesPath);
    fs.writeFileSync(localChangesPath, '');

    const oversizedMemberPath = path.join(
        libplaceboRoot,
        'oversized-source-member.bin'
    );
    fs.writeFileSync(oversizedMemberPath, '');
    fs.truncateSync(oversizedMemberPath, 128 * 1024 * 1024 + 1);
    const oversizedMemberArchivePath = path.join(
        temporaryRoot,
        'oversized-member-source.tar.xz'
    );
    const oversizedMemberTarResult = childProcess.spawnSync(
        'tar',
        [
            '--create',
            '--xz',
            '--file',
            oversizedMemberArchivePath,
            '--directory',
            sourceRoot,
            '.',
        ],
        { encoding: 'utf8' }
    );
    assert.equal(oversizedMemberTarResult.error, undefined);
    assert.equal(
        oversizedMemberTarResult.status,
        0,
        oversizedMemberTarResult.stderr
    );
    assert.throws(
        () =>
            sourceBindingHelper.inspectSourceArchive(
                oversizedMemberArchivePath,
                {
                    expectedSourceSnapshotSha256:
                        fixture.expectedSourceSnapshotSha256,
                }
            ),
        /member exceeds.*size limit/i
    );
    fs.unlinkSync(oversizedMemberPath);

    const snapSourceRoot = path.join(temporaryRoot, 'snap-source');
    const appRoot = path.join(snapSourceRoot, 'usr', 'lib', 'iptvnator');
    const nativeRoot = path.join(
        appRoot,
        'resources',
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    fs.mkdirSync(nativeRoot, { recursive: true });
    const electronHeader = Buffer.alloc(20);
    electronHeader.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    electronHeader.writeUInt16LE(62, 18);
    fs.writeFileSync(path.join(appRoot, 'iptvnator.bin'), electronHeader);
    const packagedManifest = {
        ...fixture.snapPayloads['IPTVnator-amd64.snap'].manifest,
        sourceArchive,
        sourceRuntime,
    };
    fs.writeFileSync(
        path.join(nativeRoot, 'embedded-mpv-runtime.json'),
        `${JSON.stringify(packagedManifest)}\n`
    );
    const snapPath = path.join(temporaryRoot, 'IPTVnator-amd64.snap');
    fs.writeFileSync(snapPath, 'synthetic Snap bytes');
    const staticValidationCalls = [];
    const snapPayload = sourceBindingHelper.inspectSnapPayload(
        snapPath,
        { id: 1, name: 'IPTVnator-amd64.snap' },
        {
            runCommand: (command, args) => {
                assert.equal(command, 'unsquashfs');
                if (args[0] === '-lln') {
                    return syntheticSquashfsListing();
                }
                const destinationIndex = args.indexOf('-dest') + 1;
                assert.ok(destinationIndex > 0);
                fs.cpSync(snapSourceRoot, args[destinationIndex], {
                    recursive: true,
                });
                return '';
            },
            validatePackagedEmbeddedMpv: (resourceDirectory, options) => {
                staticValidationCalls.push({ options, resourceDirectory });
                return [];
            },
        }
    );
    assert.deepEqual(snapPayload, {
        architecture: 'x64',
        assetName: 'IPTVnator-amd64.snap',
        manifest: packagedManifest,
        markerOnly: false,
    });
    assert.equal(staticValidationCalls.length, 1);
    assert.ok(
        staticValidationCalls[0].resourceDirectory.endsWith(
            ['payload', 'usr', 'lib', 'iptvnator', 'resources'].join(path.sep)
        )
    );
    assert.deepEqual(staticValidationCalls[0].options, {
        artifactFormat: 'snap',
        executableName: 'iptvnator',
        foreignArch: false,
        hostPlatform: 'linux',
        platform: 'linux',
        profile: 'portable',
        required: true,
        targetArch: 'x64',
        targetNames: ['appimage', 'snap'],
    });
    assert.equal(
        sourceBindingHelper.verifySnapReleaseSourceBinding(
            {
                expectedRepositoryRevision: fixture.repositoryRevision,
                sourceInspection,
                snapPayloads: [snapPayload],
            },
            {
                expectedSourceSnapshotSha256:
                    fixture.expectedSourceSnapshotSha256,
                validateRuntimeManifest: () => [],
            }
        ),
        true
    );

    assert.throws(
        () =>
            sourceBindingHelper.inspectSnapPayload(
                snapPath,
                { id: 1, name: 'IPTVnator-amd64.snap' },
                {
                    runCommand: (command, args) => {
                        assert.equal(command, 'unsquashfs');
                        if (args[0] === '-lln') {
                            return syntheticSquashfsListing();
                        }
                        const destinationIndex = args.indexOf('-dest') + 1;
                        fs.cpSync(snapSourceRoot, args[destinationIndex], {
                            recursive: true,
                        });
                        return '';
                    },
                    validatePackagedEmbeddedMpv: () => [
                        'Hidden inherited frame-copy artifact.',
                    ],
                }
            ),
        /Hidden inherited frame-copy artifact/
    );

    const decoySourceRoot = path.join(temporaryRoot, 'decoy-snap-source');
    const decoyAppRoot = path.join(decoySourceRoot, 'decoy');
    fs.cpSync(appRoot, decoyAppRoot, { recursive: true });
    assert.throws(
        () =>
            sourceBindingHelper.inspectSnapPayload(
                snapPath,
                { id: 1, name: 'IPTVnator-amd64.snap' },
                {
                    runCommand: (command, args) => {
                        assert.equal(command, 'unsquashfs');
                        if (args[0] === '-lln') {
                            return syntheticSquashfsListing();
                        }
                        const destinationIndex = args.indexOf('-dest') + 1;
                        fs.cpSync(decoySourceRoot, args[destinationIndex], {
                            recursive: true,
                        });
                        return '';
                    },
                    validatePackagedEmbeddedMpv: () => {
                        throw new Error(
                            'Static validation must not inspect a decoy root.'
                        );
                    },
                }
            ),
        /canonical frame-copy manifest/i
    );

    const manifestPath = path.join(nativeRoot, 'embedded-mpv-runtime.json');
    fs.truncateSync(manifestPath, 16 * 1024 * 1024 + 1);
    let oversizedStaticValidationCalls = 0;
    assert.throws(
        () =>
            sourceBindingHelper.inspectSnapPayload(
                snapPath,
                { id: 1, name: 'IPTVnator-amd64.snap' },
                {
                    runCommand: (command, args) => {
                        assert.equal(command, 'unsquashfs');
                        if (args[0] === '-lln') {
                            return syntheticSquashfsListing();
                        }
                        const destinationIndex = args.indexOf('-dest') + 1;
                        fs.cpSync(snapSourceRoot, args[destinationIndex], {
                            recursive: true,
                        });
                        return '';
                    },
                    validatePackagedEmbeddedMpv: () => {
                        oversizedStaticValidationCalls += 1;
                        return [];
                    },
                }
            ),
        /invalid frame-copy manifest/i
    );
    assert.equal(oversizedStaticValidationCalls, 0);
});

test('publish workflow installs the source verifier and binds the release tag revision', () => {
    const workflow = fs.readFileSync(publishWorkflowPath, 'utf8');
    const parsedWorkflow = parse(workflow);
    const verifyJob = parsedWorkflow.jobs['verify-snap'];
    const publishJob = parsedWorkflow.jobs['publish-snap'];
    const uploadStep = publishJob.steps.find(
        (step) => step.name === 'Publish all public-release snaps to edge'
    );
    const checkoutStep = verifyJob.steps.find(
        (step) => step.name === 'Checkout released tooling'
    );
    const snapcraftStep = publishJob.steps.find(
        (step) => step.name === 'Install Snapcraft'
    );
    const selectStep = verifyJob.steps.find(
        (step) => step.name === 'Select exact public release assets'
    );
    const downloadStep = verifyJob.steps.find(
        (step) => step.name === 'Download exact public release assets'
    );
    const verifyStep = verifyJob.steps.find(
        (step) => step.name === 'Verify downloaded public release assets'
    );
    const sealedVerifyStep = verifyJob.steps.find(
        (step) => step.name === 'Reverify sealed public release assets'
    );
    const transferStep = verifyJob.steps.find(
        (step) => step.name === 'Transfer verified release assets'
    );
    const artifactDownloadStep = publishJob.steps.find(
        (step) => step.name === 'Download verified release assets'
    );
    const transferredSealStep = publishJob.steps.find(
        (step) => step.name === 'Seal transferred public release assets'
    );
    assert.equal(verifyJob['timeout-minutes'], 45);
    assert.equal(publishJob['timeout-minutes'], 20);
    assert.equal(publishJob.needs, 'verify-snap');
    assert.match(
        workflow,
        /apt-get install[\s\S]*binutils[\s\S]*squashfs-tools[\s\S]*xz-utils/
    );
    assert.match(
        workflow,
        /release-snap-assets\.cjs verify[\s\S]*--repository-revision/
    );
    assert.ok(
        workflow.indexOf('--repository-revision') <
            workflow.indexOf('snapcraft upload --release=edge')
    );
    assert.equal(JSON.stringify(verifyJob).includes('snapcraft_token'), false);
    assert.equal(
        checkoutStep.with?.['persist-credentials'],
        false,
        'release checkout must not persist github.token for later steps'
    );
    assert.equal(
        checkoutStep.uses,
        'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5'
    );
    assert.equal(snapcraftStep.uses, undefined);
    assert.match(
        snapcraftStep.run,
        /sudo snap install snapcraft --classic --channel=stable/
    );
    assert.match(verifyStep.run, /--verified-directory/);
    assert.match(verifyStep.run, /chown -R root:root/);
    assert.match(verifyStep.run, /chmod 0555/);
    assert.match(verifyStep.run, /chmod 0444/);
    assert.match(
        verifyStep.run,
        /SEALED_ASSET_PARENT="\/var\/lib\/iptvnator-snap-release"/
    );
    assert.match(
        verifyStep.run,
        /sudo mv "\$\{VERIFIED_ASSET_STAGING\}" "\$\{SEALED_ASSET_DIRECTORY\}"/
    );
    assert.ok(sealedVerifyStep);
    assert.equal(sealedVerifyStep.env, undefined);
    assert.match(
        sealedVerifyStep.run,
        /release-snap-assets\.cjs verify-sealed/
    );
    assert.ok(
        verifyJob.steps.indexOf(sealedVerifyStep) <
            verifyJob.steps.indexOf(transferStep)
    );
    assert.equal(
        transferStep.uses,
        'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
    );
    assert.equal(
        artifactDownloadStep.uses,
        'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093'
    );
    assert.ok(
        publishJob.steps.indexOf(artifactDownloadStep) <
            publishJob.steps.indexOf(transferredSealStep)
    );
    assert.ok(
        publishJob.steps.indexOf(transferredSealStep) <
            publishJob.steps.indexOf(snapcraftStep)
    );
    assert.ok(
        publishJob.steps.indexOf(snapcraftStep) <
            publishJob.steps.indexOf(uploadStep)
    );
    assert.match(
        uploadStep.run,
        /VERIFIED_ASSET_DIRECTORY="\/var\/lib\/iptvnator-snap-release\/assets"/
    );
    assert.doesNotMatch(uploadStep.run, /\bnode\b/);
    assert.doesNotMatch(uploadStep.run, /release-snap-assets\.cjs/);
    assert.doesNotMatch(uploadStep.run, /\bfind\b|\bsort\b/);
    assert.match(
        uploadStep.run,
        /SNAP_FILES=\("\$\{VERIFIED_ASSET_DIRECTORY\}"\/\*\.snap\)/
    );
    assert.match(
        uploadStep.run,
        /SNAPCRAFT_STORE_CREDENTIALS="\$\{STORE_CREDENTIALS\}" \/snap\/bin\/snapcraft upload/
    );
    assert.doesNotMatch(
        uploadStep.run,
        /snap-release-downloads\/\$\{SNAP_NAME\}/
    );
    assert.equal(
        Object.hasOwn(publishJob.env ?? {}, 'SNAPCRAFT_STORE_CREDENTIALS'),
        false
    );
    assert.equal(Object.hasOwn(publishJob.env ?? {}, 'GH_TOKEN'), false);
    assert.deepEqual(selectStep.env, {
        GH_TOKEN: '${{ github.token }}',
    });
    assert.deepEqual(downloadStep.env, {
        GH_TOKEN: '${{ github.token }}',
    });
    assert.equal(verifyStep.env, undefined);
    assert.deepEqual(uploadStep.env, {
        SNAPCRAFT_STORE_CREDENTIALS: '${{ secrets.snapcraft_token }}',
    });
});
