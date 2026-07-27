#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { SOURCE_PACKAGES } = require('./build-linux-runtime.cjs');

const LICENSE_INPUT_MANIFEST = 'linux-runtime-license-inputs.json';
const NOTICE_MANIFEST = 'embedded-mpv-notices.json';
const THIRD_PARTY_NOTICES = 'THIRD_PARTY_NOTICES.txt';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const NOTICE_SOURCE_PACKAGES = Object.freeze(
    [...SOURCE_PACKAGES].sort(({ id: left }, { id: right }) =>
        compareText(left, right)
    )
);

const LICENSE_PATHS_BY_PACKAGE = Object.freeze({
    freetype: Object.freeze(['LICENSE.TXT', 'docs/FTL.TXT']),
    fribidi: Object.freeze(['COPYING']),
    harfbuzz: Object.freeze(['COPYING']),
    expat: Object.freeze(['COPYING']),
    fontconfig: Object.freeze(['COPYING']),
    libass: Object.freeze(['COPYING']),
    openssl: Object.freeze(['LICENSE.txt']),
    ffmpeg: Object.freeze(['LICENSE.md', 'COPYING.LGPLv2.1']),
    libplacebo: Object.freeze([
        'LICENSE',
        '3rdparty/Vulkan-Headers/LICENSE.md',
        '3rdparty/fast_float/LICENSE-APACHE',
        '3rdparty/fast_float/LICENSE-BOOST',
        '3rdparty/fast_float/LICENSE-MIT',
        '3rdparty/glad/LICENSE',
        '3rdparty/jinja/LICENSE.txt',
        '3rdparty/markupsafe/LICENSE.txt',
        'demos/3rdparty/nuklear/LICENSE',
    ]),
    hwdata: Object.freeze(['LICENSE', 'COPYING']),
    'libdisplay-info': Object.freeze(['LICENSE']),
    mpv: Object.freeze(['Copyright', 'LICENSE.LGPL']),
});

function sha256(contents) {
    return crypto.createHash('sha256').update(contents).digest('hex');
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(value, fields) {
    return (
        isObject(value) &&
        isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort())
    );
}

function isPathInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return (
        relative === '' ||
        (relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
    );
}

function assertDirectoryWithoutSymlinks(directoryPath, label) {
    let stat;
    try {
        stat = fs.lstatSync(directoryPath);
    } catch {
        throw new Error(`Missing ${label}: ${directoryPath}`);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`${label} must be a real directory: ${directoryPath}`);
    }
    return fs.realpathSync(directoryPath);
}

function assertRegularFileInside(root, relativePath, label) {
    if (
        typeof relativePath !== 'string' ||
        relativePath.length === 0 ||
        path.isAbsolute(relativePath) ||
        relativePath.split(/[\\/]/).some((part) => part === '..' || part === '')
    ) {
        throw new Error(
            `${label} has an unsafe relative path: ${relativePath}`
        );
    }
    const realRoot = assertDirectoryWithoutSymlinks(root, `${label} root`);
    const candidate = path.resolve(root, ...relativePath.split('/'));
    if (!isPathInside(path.resolve(root), candidate)) {
        throw new Error(`${label} resolves outside ${root}: ${relativePath}`);
    }

    let cursor = path.resolve(root);
    const parts = path.relative(cursor, candidate).split(path.sep);
    for (const [index, part] of parts.entries()) {
        cursor = path.join(cursor, part);
        let stat;
        try {
            stat = fs.lstatSync(cursor);
        } catch {
            throw new Error(`Missing ${label}: ${cursor}`);
        }
        if (stat.isSymbolicLink()) {
            throw new Error(`${label} must not use a symbolic link: ${cursor}`);
        }
        if (index < parts.length - 1 && !stat.isDirectory()) {
            throw new Error(`${label} parent must be a directory: ${cursor}`);
        }
        if (index === parts.length - 1 && !stat.isFile()) {
            throw new Error(`${label} must be a regular file: ${cursor}`);
        }
    }

    const realCandidate = fs.realpathSync(candidate);
    if (!isPathInside(realRoot, realCandidate)) {
        throw new Error(
            `${label} resolves outside its trusted root: ${relativePath}`
        );
    }
    return realCandidate;
}

function sourcePackageMetadata(sourcePackage) {
    return {
        version: sourcePackage.version,
        sourceUrl: sourcePackage.sourceUrl,
        ...(sourcePackage.sourceTag
            ? { sourceTag: sourcePackage.sourceTag }
            : {}),
        ...(sourcePackage.sourceKind === 'archive'
            ? { sourceSha256: sourcePackage.expectedSha256 }
            : { sourceGitCommit: sourcePackage.expectedGitCommit }),
        license: sourcePackage.license,
    };
}

function validateRuntimeManifestPackages(runtimeManifest) {
    if (
        !isObject(runtimeManifest) ||
        runtimeManifest.platform !== 'linux' ||
        runtimeManifest.arch !== 'x64' ||
        !isObject(runtimeManifest.packages) ||
        !isDeepStrictEqual(
            Object.keys(runtimeManifest.packages).sort(),
            SOURCE_PACKAGES.map(({ id }) => id).sort()
        )
    ) {
        throw new Error(
            'Linux runtime notice generation requires the exact pinned linux-x64 package manifest.'
        );
    }
    for (const sourcePackage of SOURCE_PACKAGES) {
        const actual = runtimeManifest.packages[sourcePackage.id];
        const expected = sourcePackageMetadata(sourcePackage);
        for (const [field, expectedValue] of Object.entries(expected)) {
            if (!isDeepStrictEqual(actual?.[field], expectedValue)) {
                throw new Error(
                    `Linux runtime package ${sourcePackage.id}.${field} does not match its immutable pin.`
                );
            }
        }
        if (
            sourcePackage.sourceKind === 'git' &&
            (!Array.isArray(actual.sourceSubmodules) ||
                actual.sourceSubmodules.length === 0)
        ) {
            throw new Error(
                `Linux runtime package ${sourcePackage.id} must record pinned submodules.`
            );
        }
        const licensePaths = LICENSE_PATHS_BY_PACKAGE[sourcePackage.id];
        if (!Array.isArray(licensePaths) || licensePaths.length === 0) {
            throw new Error(
                `Linux runtime package ${sourcePackage.id} has no pinned upstream license files.`
            );
        }
    }
}

function fileRecord(filePath, relativePath) {
    const contents = fs.readFileSync(filePath);
    return {
        path: relativePath.split(path.sep).join('/'),
        size: contents.length,
        sha256: sha256(contents),
    };
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
        mode: 0o644,
    });
}

function replaceDirectory(outputRoot, writer) {
    const resolvedOutputRoot = path.resolve(outputRoot);
    const temporaryRoot = `${resolvedOutputRoot}.tmp-${process.pid}-${crypto
        .randomBytes(8)
        .toString('hex')}`;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.mkdirSync(temporaryRoot, { recursive: true });
    try {
        const result = writer(temporaryRoot);
        fs.rmSync(resolvedOutputRoot, { recursive: true, force: true });
        fs.renameSync(temporaryRoot, resolvedOutputRoot);
        return result;
    } catch (error) {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
        throw error;
    }
}

function expectedLicensePath(packageId, sourceRelativePath) {
    return path.posix.join('licenses', packageId, sourceRelativePath);
}

function collectLinuxRuntimeLicenseInputs({
    sourceRoot,
    outputRoot,
    runtimeManifest,
}) {
    validateRuntimeManifestPackages(runtimeManifest);
    assertDirectoryWithoutSymlinks(sourceRoot, 'Linux runtime source root');

    return replaceDirectory(outputRoot, (temporaryRoot) => {
        const packages = NOTICE_SOURCE_PACKAGES.map((sourcePackage) => {
            const files = LICENSE_PATHS_BY_PACKAGE[sourcePackage.id].map(
                (sourceRelativePath) => {
                    const sourcePath = assertRegularFileInside(
                        path.join(sourceRoot, sourcePackage.id),
                        sourceRelativePath,
                        `${sourcePackage.id} upstream license`
                    );
                    const relativeOutputPath = expectedLicensePath(
                        sourcePackage.id,
                        sourceRelativePath
                    );
                    const destinationPath = path.join(
                        temporaryRoot,
                        ...relativeOutputPath.split('/')
                    );
                    fs.mkdirSync(path.dirname(destinationPath), {
                        recursive: true,
                    });
                    fs.copyFileSync(sourcePath, destinationPath);
                    fs.chmodSync(destinationPath, 0o644);
                    return {
                        sourcePath: sourceRelativePath,
                        ...fileRecord(destinationPath, relativeOutputPath),
                    };
                }
            );
            return {
                id: sourcePackage.id,
                ...sourcePackageMetadata(sourcePackage),
                files,
            };
        });
        const manifest = {
            schemaVersion: 1,
            origin: 'pinned-linux-runtime-license-inputs',
            platform: 'linux',
            arch: 'x64',
            packages,
        };
        writeJson(path.join(temporaryRoot, LICENSE_INPUT_MANIFEST), manifest);
        return manifest;
    });
}

function listFilesRecursively(root) {
    const files = [];
    function visit(directoryPath) {
        for (const entry of fs
            .readdirSync(directoryPath, { withFileTypes: true })
            .sort((left, right) => compareText(left.name, right.name))) {
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(
                    `Linux runtime legal files must not use symbolic links: ${entryPath}`
                );
            }
            if (entry.isDirectory()) {
                visit(entryPath);
            } else if (entry.isFile()) {
                files.push(
                    path.relative(root, entryPath).split(path.sep).join('/')
                );
            } else {
                throw new Error(
                    `Linux runtime legal input must be a regular file: ${entryPath}`
                );
            }
        }
    }
    visit(root);
    return files;
}

function readJsonFileInside(root, relativePath, label) {
    const filePath = assertRegularFileInside(root, relativePath, label);
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(
            `Invalid JSON in ${label}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

function validateLicenseInputManifest(inputRoot, runtimeManifest) {
    validateRuntimeManifestPackages(runtimeManifest);
    const inputManifest = readJsonFileInside(
        inputRoot,
        LICENSE_INPUT_MANIFEST,
        'Linux runtime license input manifest'
    );
    if (
        !hasExactFields(inputManifest, [
            'schemaVersion',
            'origin',
            'platform',
            'arch',
            'packages',
        ]) ||
        inputManifest.schemaVersion !== 1 ||
        inputManifest.origin !== 'pinned-linux-runtime-license-inputs' ||
        inputManifest.platform !== 'linux' ||
        inputManifest.arch !== 'x64' ||
        !Array.isArray(inputManifest.packages) ||
        inputManifest.packages.length !== NOTICE_SOURCE_PACKAGES.length
    ) {
        throw new Error('Invalid Linux runtime license input manifest.');
    }

    const expectedPaths = new Set([LICENSE_INPUT_MANIFEST]);
    for (const [index, sourcePackage] of NOTICE_SOURCE_PACKAGES.entries()) {
        const packageRecord = inputManifest.packages[index];
        const expectedMetadata = sourcePackageMetadata(sourcePackage);
        if (
            !hasExactFields(packageRecord, [
                'id',
                ...Object.keys(expectedMetadata),
                'files',
            ]) ||
            packageRecord.id !== sourcePackage.id ||
            !Object.entries(expectedMetadata).every(([field, value]) =>
                isDeepStrictEqual(packageRecord[field], value)
            ) ||
            !Array.isArray(packageRecord.files) ||
            packageRecord.files.length !==
                LICENSE_PATHS_BY_PACKAGE[sourcePackage.id].length
        ) {
            throw new Error(
                `Invalid cached license inputs for ${sourcePackage.id}.`
            );
        }
        for (const [fileIndex, sourceRelativePath] of LICENSE_PATHS_BY_PACKAGE[
            sourcePackage.id
        ].entries()) {
            const record = packageRecord.files[fileIndex];
            const expectedPath = expectedLicensePath(
                sourcePackage.id,
                sourceRelativePath
            );
            if (
                !hasExactFields(record, [
                    'sourcePath',
                    'path',
                    'size',
                    'sha256',
                ]) ||
                record.sourcePath !== sourceRelativePath ||
                record.path !== expectedPath ||
                !Number.isSafeInteger(record.size) ||
                record.size <= 0 ||
                !SHA256_PATTERN.test(record.sha256)
            ) {
                throw new Error(
                    `Invalid cached license file record for ${sourcePackage.id}.`
                );
            }
            const inputPath = assertRegularFileInside(
                inputRoot,
                record.path,
                `${sourcePackage.id} license input`
            );
            const actual = fileRecord(inputPath, record.path);
            if (actual.size !== record.size) {
                throw new Error(
                    `Size mismatch for cached license input ${record.path}.`
                );
            }
            if (actual.sha256 !== record.sha256) {
                throw new Error(
                    `SHA-256 mismatch for cached license input ${record.path}.`
                );
            }
            expectedPaths.add(record.path);
        }
    }
    for (const actualPath of listFilesRecursively(inputRoot)) {
        if (!expectedPaths.has(actualPath)) {
            throw new Error(
                `Found undeclared license input ${actualPath} in ${inputRoot}.`
            );
        }
    }
    return inputManifest;
}

function noticePackageRecord(sourcePackage, inputPackage) {
    return {
        id: sourcePackage.id,
        ...sourcePackageMetadata(sourcePackage),
        files: inputPackage.files.map(
            ({ path: filePath, size, sha256: hash }) => ({
                path: filePath,
                size,
                sha256: hash,
            })
        ),
    };
}

function createThirdPartyNotices(packages) {
    const lines = [
        'IPTVnator Linux Embedded MPV Third-Party Notices',
        '================================================',
        '',
        'This file identifies the pinned upstream source packages used by the bundled Linux Embedded MPV runtime.',
        'The complete verbatim upstream license files are included at the paths and SHA-256 digests listed below.',
        'The exact corresponding sources and build scripts are distributed alongside the binary release as linux-frame-copy-runtime-sources.tar.xz.',
        '',
    ];
    for (const packageRecord of packages) {
        lines.push(
            `${packageRecord.id} ${packageRecord.version}`,
            `License: ${packageRecord.license}`,
            `Source: ${packageRecord.sourceUrl}`,
            'Included upstream license files:'
        );
        for (const file of packageRecord.files) {
            lines.push(`- ${file.path} (SHA-256 ${file.sha256})`);
        }
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}

function generateLinuxRuntimeNotices({
    licenseInputRoot,
    outputRoot,
    runtimeManifest,
}) {
    const inputManifest = validateLicenseInputManifest(
        licenseInputRoot,
        runtimeManifest
    );
    return replaceDirectory(outputRoot, (temporaryRoot) => {
        const packages = NOTICE_SOURCE_PACKAGES.map((sourcePackage, index) => {
            const inputPackage = inputManifest.packages[index];
            for (const file of inputPackage.files) {
                const sourcePath = assertRegularFileInside(
                    licenseInputRoot,
                    file.path,
                    `${sourcePackage.id} cached license`
                );
                const destinationPath = path.join(
                    temporaryRoot,
                    ...file.path.split('/')
                );
                fs.mkdirSync(path.dirname(destinationPath), {
                    recursive: true,
                });
                fs.copyFileSync(sourcePath, destinationPath);
                fs.chmodSync(destinationPath, 0o644);
            }
            return noticePackageRecord(sourcePackage, inputPackage);
        });
        const noticeContents = Buffer.from(createThirdPartyNotices(packages));
        const noticePath = path.join(temporaryRoot, THIRD_PARTY_NOTICES);
        fs.writeFileSync(noticePath, noticeContents, { mode: 0o644 });
        const noticeFile = fileRecord(noticePath, THIRD_PARTY_NOTICES);
        const licenseTotalBytes = packages
            .flatMap(({ files }) => files)
            .reduce((total, file) => total + file.size, 0);
        const manifest = {
            schemaVersion: 1,
            origin: 'pinned-linux-runtime-upstream-licenses',
            platform: 'linux',
            arch: 'x64',
            noticeFile,
            packages,
            totalBytes: noticeFile.size + licenseTotalBytes,
        };
        writeJson(path.join(temporaryRoot, NOTICE_MANIFEST), manifest);
        const errors = validateLinuxRuntimeNotices(
            temporaryRoot,
            runtimeManifest
        );
        if (errors.length > 0) {
            throw new Error(
                [
                    'Generated Linux runtime notices are invalid.',
                    ...errors.map((error) => `- ${error}`),
                ].join('\n')
            );
        }
        return manifest;
    });
}

function assertValidLinuxRuntimeNotices(
    root,
    runtimeManifest,
    { allowUnrelatedFiles = false } = {}
) {
    validateRuntimeManifestPackages(runtimeManifest);
    assertDirectoryWithoutSymlinks(root, 'Linux runtime notices root');
    const manifest = readJsonFileInside(
        root,
        NOTICE_MANIFEST,
        'Linux runtime notices manifest'
    );
    if (
        !hasExactFields(manifest, [
            'schemaVersion',
            'origin',
            'platform',
            'arch',
            'noticeFile',
            'packages',
            'totalBytes',
        ]) ||
        manifest.schemaVersion !== 1 ||
        manifest.origin !== 'pinned-linux-runtime-upstream-licenses' ||
        manifest.platform !== 'linux' ||
        manifest.arch !== 'x64' ||
        !Array.isArray(manifest.packages) ||
        manifest.packages.length !== NOTICE_SOURCE_PACKAGES.length
    ) {
        throw new Error('Invalid Linux runtime notices manifest.');
    }

    const expectedFiles = new Set([NOTICE_MANIFEST, THIRD_PARTY_NOTICES]);
    let licenseTotalBytes = 0;
    for (const [index, sourcePackage] of NOTICE_SOURCE_PACKAGES.entries()) {
        const packageRecord = manifest.packages[index];
        const expectedMetadata = sourcePackageMetadata(sourcePackage);
        const expectedPaths = LICENSE_PATHS_BY_PACKAGE[sourcePackage.id].map(
            (sourceRelativePath) =>
                expectedLicensePath(sourcePackage.id, sourceRelativePath)
        );
        if (
            !hasExactFields(packageRecord, [
                'id',
                ...Object.keys(expectedMetadata),
                'files',
            ]) ||
            packageRecord.id !== sourcePackage.id ||
            !Object.entries(expectedMetadata).every(([field, value]) =>
                isDeepStrictEqual(packageRecord[field], value)
            ) ||
            !Array.isArray(packageRecord.files) ||
            !isDeepStrictEqual(
                packageRecord.files.map(({ path: filePath }) => filePath),
                expectedPaths
            )
        ) {
            throw new Error(
                `Invalid packaged notice record for ${sourcePackage.id}.`
            );
        }
        for (const record of packageRecord.files) {
            if (
                !hasExactFields(record, ['path', 'size', 'sha256']) ||
                !Number.isSafeInteger(record.size) ||
                record.size <= 0 ||
                !SHA256_PATTERN.test(record.sha256)
            ) {
                throw new Error(
                    `Invalid packaged notice file for ${sourcePackage.id}.`
                );
            }
            const filePath = assertRegularFileInside(
                root,
                record.path,
                `${sourcePackage.id} packaged license`
            );
            const actual = fileRecord(filePath, record.path);
            if (actual.size !== record.size) {
                throw new Error(
                    `Size mismatch for packaged license ${record.path}.`
                );
            }
            if (actual.sha256 !== record.sha256) {
                throw new Error(
                    `SHA-256 mismatch for packaged license ${record.path}.`
                );
            }
            licenseTotalBytes += record.size;
            expectedFiles.add(record.path);
        }
    }

    if (
        !hasExactFields(manifest.noticeFile, ['path', 'size', 'sha256']) ||
        manifest.noticeFile.path !== THIRD_PARTY_NOTICES ||
        !Number.isSafeInteger(manifest.noticeFile.size) ||
        manifest.noticeFile.size <= 0 ||
        !SHA256_PATTERN.test(manifest.noticeFile.sha256)
    ) {
        throw new Error('Invalid aggregate third-party notice file record.');
    }
    const noticePath = assertRegularFileInside(
        root,
        THIRD_PARTY_NOTICES,
        'aggregate third-party notices'
    );
    const actualNotice = fileRecord(noticePath, THIRD_PARTY_NOTICES);
    if (
        actualNotice.size !== manifest.noticeFile.size ||
        actualNotice.sha256 !== manifest.noticeFile.sha256
    ) {
        throw new Error(
            'Aggregate THIRD_PARTY_NOTICES.txt size or SHA-256 mismatch.'
        );
    }
    const expectedNoticeContents = createThirdPartyNotices(manifest.packages);
    if (fs.readFileSync(noticePath, 'utf8') !== expectedNoticeContents) {
        throw new Error(
            'Aggregate THIRD_PARTY_NOTICES.txt does not match the exact notice index.'
        );
    }
    if (manifest.totalBytes !== actualNotice.size + licenseTotalBytes) {
        throw new Error(
            'Linux runtime notices totalBytes does not match declared legal files.'
        );
    }
    const actualPaths = allowUnrelatedFiles
        ? [
              NOTICE_MANIFEST,
              THIRD_PARTY_NOTICES,
              ...listFilesRecursively(path.join(root, 'licenses')).map(
                  (relativePath) => path.posix.join('licenses', relativePath)
              ),
          ]
        : listFilesRecursively(root);
    for (const actualPath of actualPaths) {
        if (!expectedFiles.has(actualPath)) {
            throw new Error(
                `Found undeclared packaged legal file ${actualPath} in ${root}.`
            );
        }
    }
    return manifest;
}

function validateLinuxRuntimeNotices(root, runtimeManifest, options) {
    try {
        assertValidLinuxRuntimeNotices(root, runtimeManifest, options);
        return [];
    } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
    }
}

function parseArguments(argv) {
    const args = argv[0] === '--' ? argv.slice(1) : [...argv];
    const mode = args.shift();
    if (!['collect', 'generate'].includes(mode)) {
        throw new Error(
            'Usage: generate-linux-runtime-notices.cjs <collect|generate> --runtime-manifest <path> --output-root <path> [--source-root <path>|--license-input-root <path>]'
        );
    }
    const values = {};
    while (args.length > 0) {
        const key = args.shift();
        const value = args.shift();
        if (!key?.startsWith('--') || !value) {
            throw new Error(`Invalid Linux runtime notices argument: ${key}`);
        }
        const name = key.slice(2);
        if (Object.hasOwn(values, name)) {
            throw new Error(`Duplicate Linux runtime notices argument: ${key}`);
        }
        values[name] = value;
    }
    const required = [
        'runtime-manifest',
        'output-root',
        mode === 'collect' ? 'source-root' : 'license-input-root',
    ];
    for (const name of required) {
        if (!values[name]) {
            throw new Error(`Missing --${name}.`);
        }
    }
    return { mode, values };
}

function main(argv = process.argv.slice(2)) {
    const { mode, values } = parseArguments(argv);
    const runtimeManifest = JSON.parse(
        fs.readFileSync(path.resolve(values['runtime-manifest']), 'utf8')
    );
    if (mode === 'collect') {
        collectLinuxRuntimeLicenseInputs({
            sourceRoot: path.resolve(values['source-root']),
            outputRoot: path.resolve(values['output-root']),
            runtimeManifest,
        });
    } else {
        generateLinuxRuntimeNotices({
            licenseInputRoot: path.resolve(values['license-input-root']),
            outputRoot: path.resolve(values['output-root']),
            runtimeManifest,
        });
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    }
}

module.exports = {
    LICENSE_INPUT_MANIFEST,
    LICENSE_PATHS_BY_PACKAGE,
    NOTICE_MANIFEST,
    THIRD_PARTY_NOTICES,
    collectLinuxRuntimeLicenseInputs,
    generateLinuxRuntimeNotices,
    validateLinuxRuntimeNotices,
};
