'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const {
    validateLinuxRuntimeManifest,
} = require('../embedded-mpv/linux-runtime-manifest.cjs');
const {
    validateLinuxSourceArchiveBinding,
} = require('../embedded-mpv/linux-source-archive-contract.cjs');
const {
    NOTICE_MANIFEST,
    THIRD_PARTY_NOTICES,
    validateLinuxRuntimeNotices,
} = require('../embedded-mpv/generate-linux-runtime-notices.cjs');
const {
    LINUX_SYSTEM_PACKAGE_DEPENDENCIES,
    resolveLinuxFrameCopyProfile,
    validateLinuxProfileTargets,
} = require('./linux-frame-copy-profile.cjs');

const FRAME_COPY_HELPER = 'iptvnator_mpv_helper';
const WINDOWS_FRAME_COPY_HELPER = 'iptvnator_mpv_helper.exe';
const FRAME_COPY_READER = 'embedded_mpv_frame_reader.node';
const EMBEDDED_MPV_ADDON = 'embedded_mpv.node';
const RUNTIME_MANIFEST = 'embedded-mpv-runtime.json';
const UNAVAILABLE_MARKER = 'embedded-mpv-unavailable.txt';
const LICENSES_DIRECTORY = 'licenses';
const VERSIONED_LIBMPV_PATTERN = /^libmpv\.so\.\d+(?:\.\d+)*$/;
const EXPECTED_ARTIFACTS = Object.freeze({
    addon: EMBEDDED_MPV_ADDON,
    frameReader: FRAME_COPY_READER,
    helper: FRAME_COPY_HELPER,
});
const EXPECTED_PROCESS_ISOLATION = Object.freeze({
    addonLoadsLibmpv: false,
    helperLinksLibmpv: true,
    helperRunpath: Object.freeze(['$ORIGIN/lib']),
});

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonFile(filePath, label) {
    let contents;
    try {
        contents = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        throw new Error(
            `Unable to read ${label} at ${filePath}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
    try {
        return JSON.parse(contents);
    } catch (error) {
        throw new Error(
            `Invalid JSON in ${label} at ${filePath}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }
}

function assertRegularReadableFile(filePath, label) {
    let stat;
    try {
        stat = fs.lstatSync(filePath);
    } catch {
        throw new Error(`Missing ${label}: ${filePath}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`${label} must be a regular file: ${filePath}`);
    }
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
        throw new Error(`${label} must be readable: ${filePath}`);
    }
    return stat;
}

function sameJson(left, right) {
    return isDeepStrictEqual(left, right);
}

function normalizeTargetNames(targetNames) {
    if (!Array.isArray(targetNames) || targetNames.length === 0) {
        throw new Error(
            'Linux frame-copy packaging requires at least one target.'
        );
    }
    const normalized = [];
    for (const targetName of targetNames) {
        const name = String(targetName ?? '')
            .trim()
            .toLowerCase();
        if (!name) {
            throw new Error(
                'Linux frame-copy target names must be non-empty strings.'
            );
        }
        if (normalized.includes(name)) {
            throw new Error(`Linux frame-copy target "${name}" is duplicated.`);
        }
        normalized.push(name);
    }
    return normalized.sort();
}

function validateLinuxFrameCopyBuildManifest(manifest) {
    const errors = [];
    if (!isObject(manifest)) {
        return ['Linux frame-copy build manifest must be an object.'];
    }
    for (const [field, expected] of [
        ['schemaVersion', 1],
        ['origin', 'linux-frame-copy-build'],
        ['platform', 'linux'],
        ['arch', 'x64'],
        ['buildInputMode', 'bundled-runtime'],
        ['sourceRuntimeValidated', true],
    ]) {
        if (manifest[field] !== expected) {
            errors.push(
                `Linux frame-copy build manifest ${field} must equal ${JSON.stringify(
                    expected
                )}.`
            );
        }
    }
    if (!sameJson(manifest.allowedPackageRuntimeModes, ['system', 'bundled'])) {
        errors.push(
            'Linux frame-copy build manifest allowedPackageRuntimeModes must contain exactly system and bundled.'
        );
    }
    if (
        !sameJson(manifest.packageRuntimeAvailability, {
            system: true,
            bundled: true,
        })
    ) {
        errors.push(
            'Linux frame-copy build manifest packageRuntimeAvailability must mark exactly system and bundled as available.'
        );
    }
    if (!sameJson(manifest.artifacts, EXPECTED_ARTIFACTS)) {
        errors.push(
            'Linux frame-copy build manifest artifacts must name the addon, frame reader, and helper exactly.'
        );
    }
    if (!sameJson(manifest.processIsolation, EXPECTED_PROCESS_ISOLATION)) {
        errors.push(
            'Linux frame-copy build manifest processIsolation contract is invalid.'
        );
    }
    if (manifest.nativeViewFallback !== 'process-isolated mpv --wid') {
        errors.push(
            'Linux frame-copy build manifest nativeViewFallback contract is invalid.'
        );
    }
    if (
        typeof manifest.generatedAt !== 'string' ||
        Number.isNaN(Date.parse(manifest.generatedAt))
    ) {
        errors.push(
            'Linux frame-copy build manifest generatedAt must be a valid timestamp.'
        );
    }
    if (
        typeof manifest.libmpvSoname !== 'string' ||
        !VERSIONED_LIBMPV_PATTERN.test(manifest.libmpvSoname)
    ) {
        errors.push(
            'Linux frame-copy build manifest libmpvSoname must be a versioned libmpv SONAME.'
        );
    }
    const sourceLinkerAlias =
        manifest.sourceRuntime?.runtimeDependencyClosure?.entries?.find(
            (entry) => entry?.name === 'libmpv.so'
        );
    if (
        typeof manifest.libmpvSoname === 'string' &&
        sourceLinkerAlias?.soname !== manifest.libmpvSoname
    ) {
        errors.push(
            'Linux frame-copy build manifest libmpvSoname must be derived from the validated source runtime libmpv.so SONAME.'
        );
    }
    const sourceErrors = validateLinuxRuntimeManifest(manifest.sourceRuntime);
    errors.push(
        ...sourceErrors.map(
            (error) => `Invalid bundled source runtime: ${error}`
        )
    );
    errors.push(
        ...validateLinuxSourceArchiveBinding(manifest.sourceArchive).map(
            (error) => `Invalid Linux source archive binding: ${error}`
        )
    );
    if (
        Array.isArray(manifest.runtimeFiles) &&
        Array.isArray(manifest.sourceRuntime?.runtimeFiles) &&
        !sameJson(manifest.runtimeFiles, manifest.sourceRuntime.runtimeFiles)
    ) {
        errors.push(
            'Linux frame-copy build manifest runtimeFiles must exactly match sourceRuntime.runtimeFiles.'
        );
    }
    const expectedTotal = Array.isArray(manifest.runtimeFiles)
        ? manifest.runtimeFiles.reduce(
              (total, runtimeFile) =>
                  total +
                  (isObject(runtimeFile) &&
                  Number.isInteger(runtimeFile.size) &&
                  runtimeFile.size > 0
                      ? runtimeFile.size
                      : 0),
              0
          )
        : 0;
    if (manifest.runtimeTotalBytes !== expectedTotal) {
        errors.push(
            `Linux frame-copy build manifest runtimeTotalBytes must equal ${expectedTotal}.`
        );
    }
    if (
        Array.isArray(manifest.runtimeFiles) &&
        typeof manifest.libmpvSoname === 'string' &&
        !manifest.runtimeFiles.some(
            (runtimeFile) => runtimeFile.name === manifest.libmpvSoname
        )
    ) {
        errors.push(
            'Linux frame-copy build manifest runtimeFiles must include libmpvSoname.'
        );
    }
    return errors;
}

function verifyBundledRuntimeFiles(nativeDir, manifest) {
    const libDir = path.join(nativeDir, 'lib');
    let libDirStat;
    try {
        libDirStat = fs.lstatSync(libDir);
    } catch {
        throw new Error(`Missing bundled runtime directory: ${libDir}`);
    }
    if (!libDirStat.isDirectory() || libDirStat.isSymbolicLink()) {
        throw new Error(
            `Bundled runtime directory must be a regular directory: ${libDir}`
        );
    }

    const declaredFiles = new Map(
        manifest.runtimeFiles.map((runtimeFile) => [
            runtimeFile.name,
            runtimeFile,
        ])
    );
    for (const entry of fs.readdirSync(libDir, { withFileTypes: true })) {
        if (!declaredFiles.has(entry.name)) {
            throw new Error(
                `Found undeclared bundled runtime file ${entry.name} in ${libDir}.`
            );
        }
    }

    for (const runtimeFile of manifest.runtimeFiles) {
        const runtimePath = path.join(libDir, runtimeFile.name);
        let stat;
        try {
            stat = fs.lstatSync(runtimePath);
        } catch {
            throw new Error(`Missing bundled runtime file: ${runtimePath}`);
        }
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error(
                `Bundled runtime file must be a materialized regular file: ${runtimePath}`
            );
        }
        try {
            fs.accessSync(runtimePath, fs.constants.R_OK);
        } catch {
            throw new Error(
                `Bundled runtime file must be readable: ${runtimePath}`
            );
        }
        const contents = fs.readFileSync(runtimePath);
        if (contents.length !== runtimeFile.size) {
            throw new Error(
                `Bundled runtime file size mismatch for ${runtimeFile.name}: expected ${runtimeFile.size}, received ${contents.length}.`
            );
        }
        const actualSha256 = crypto
            .createHash('sha256')
            .update(contents)
            .digest('hex');
        if (actualSha256 !== runtimeFile.sha256) {
            throw new Error(
                `Bundled runtime file SHA-256 mismatch for ${runtimeFile.name}: expected ${runtimeFile.sha256}, received ${actualSha256}.`
            );
        }
    }
}

function writeManifest(nativeDir, manifest) {
    const manifestPath = path.join(nativeDir, RUNTIME_MANIFEST);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        mode: 0o644,
    });
    return manifest;
}

function removeLinuxRuntimeNotices(nativeDir) {
    for (const relativePath of [
        NOTICE_MANIFEST,
        THIRD_PARTY_NOTICES,
        LICENSES_DIRECTORY,
        'notices',
    ]) {
        fs.rmSync(path.join(nativeDir, relativePath), {
            recursive: true,
            force: true,
        });
    }
}

function prepareBundledLinuxRuntimeNotices(
    nativeDir,
    sourceRuntime,
    noticeSourceDir
) {
    if (noticeSourceDir) {
        const sourceErrors = validateLinuxRuntimeNotices(
            noticeSourceDir,
            sourceRuntime
        );
        if (sourceErrors.length > 0) {
            throw new Error(
                [
                    `Invalid Linux runtime notice source at ${noticeSourceDir}.`,
                    ...sourceErrors.map((error) => `- ${error}`),
                ].join('\n')
            );
        }
        removeLinuxRuntimeNotices(nativeDir);
        for (const relativePath of [
            NOTICE_MANIFEST,
            THIRD_PARTY_NOTICES,
            LICENSES_DIRECTORY,
        ]) {
            fs.cpSync(
                path.join(noticeSourceDir, relativePath),
                path.join(nativeDir, relativePath),
                {
                    recursive: true,
                    force: true,
                }
            );
        }
    }

    const packagedErrors = validateLinuxRuntimeNotices(
        nativeDir,
        sourceRuntime,
        { allowUnrelatedFiles: true }
    );
    if (packagedErrors.length > 0) {
        throw new Error(
            [
                `Invalid packaged Linux runtime notices at ${nativeDir}.`,
                ...packagedErrors.map((error) => `- ${error}`),
            ].join('\n')
        );
    }
}

function createPackagedManifest(buildManifest, profile, targetNames) {
    const bundled = profile.runtimeMode === 'bundled';
    const runtimeFiles = bundled
        ? buildManifest.runtimeFiles.map((runtimeFile) => ({ ...runtimeFile }))
        : [];
    return {
        schemaVersion: 1,
        origin: profile.manifestOrigin,
        generatedAt: buildManifest.generatedAt,
        platform: 'linux',
        arch: 'x64',
        profile: profile.name,
        runtimeMode: profile.runtimeMode,
        targets: [...new Set(targetNames)].sort(),
        artifacts: {
            addon: {
                name: EMBEDDED_MPV_ADDON,
                regularFile: true,
                readable: true,
            },
            frameReader: {
                name: FRAME_COPY_READER,
                regularFile: true,
                readable: true,
            },
            helper: {
                name: FRAME_COPY_HELPER,
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
        nativeViewFallback: buildManifest.nativeViewFallback,
        libmpvSoname: buildManifest.libmpvSoname,
        packageDependencies:
            profile.runtimeMode === 'system'
                ? { ...LINUX_SYSTEM_PACKAGE_DEPENDENCIES }
                : {},
        runtimeFiles,
        runtimeTotalBytes: runtimeFiles.reduce(
            (total, runtimeFile) => total + runtimeFile.size,
            0
        ),
        ...(bundled
            ? {
                  runtimeDependencyClosure: {
                      entries:
                          buildManifest.sourceRuntime.runtimeDependencyClosure.entries.map(
                              (entry) => ({
                                  name: entry.name,
                                  soname: entry.soname ?? null,
                                  needed: [...entry.needed],
                                  rpath: [...entry.rpath],
                                  runpath: [...entry.runpath],
                              })
                          ),
                      externalDependencies: [
                          ...buildManifest.sourceRuntime
                              .runtimeDependencyClosure.externalDependencies,
                      ],
                  },
                  externalSystemLibraries:
                      buildManifest.sourceRuntime.externalSystemLibraries.map(
                          (entry) => ({ ...entry })
                      ),
                  sourceArchive: structuredClone(buildManifest.sourceArchive),
                  sourceRuntime: structuredClone(buildManifest.sourceRuntime),
              }
            : {}),
    };
}

function prepareNativeViewOnlyLinuxArtifacts(nativeDir) {
    for (const fileName of [
        FRAME_COPY_HELPER,
        WINDOWS_FRAME_COPY_HELPER,
        FRAME_COPY_READER,
        UNAVAILABLE_MARKER,
    ]) {
        fs.rmSync(path.join(nativeDir, fileName), { force: true });
    }
    fs.rmSync(path.join(nativeDir, 'lib'), { recursive: true, force: true });
    removeLinuxRuntimeNotices(nativeDir);

    return writeManifest(nativeDir, {
        schemaVersion: 1,
        origin: 'external-mpv-process',
        platform: 'linux',
        arch: 'x64',
        runtimeMode: 'native-view-only',
        frameCopyAvailable: false,
        artifacts: {
            addon: EMBEDDED_MPV_ADDON,
        },
        nativeViewFallback: 'process-isolated mpv --wid',
    });
}

function prepareLinuxFrameCopyArtifacts(nativeDir, options = {}) {
    if (!options.profile) {
        return prepareNativeViewOnlyLinuxArtifacts(nativeDir);
    }
    const profile = resolveLinuxFrameCopyProfile(options.profile);
    const targetNames = normalizeTargetNames(options.targetNames);
    const targetErrors = validateLinuxProfileTargets(profile.name, targetNames);
    if (targetErrors.length > 0) {
        throw new Error(targetErrors.join('\n'));
    }

    const addonPath = path.join(nativeDir, EMBEDDED_MPV_ADDON);
    const readerPath = path.join(nativeDir, FRAME_COPY_READER);
    const helperPath = path.join(nativeDir, FRAME_COPY_HELPER);
    const manifestPath = path.join(nativeDir, RUNTIME_MANIFEST);
    assertRegularReadableFile(addonPath, 'embedded MPV addon');
    assertRegularReadableFile(readerPath, 'embedded MPV frame reader');
    assertRegularReadableFile(helperPath, 'embedded MPV frame-copy helper');
    assertRegularReadableFile(manifestPath, 'embedded MPV runtime manifest');

    const buildManifest = readJsonFile(
        manifestPath,
        'embedded MPV runtime manifest'
    );
    const manifestErrors = validateLinuxFrameCopyBuildManifest(buildManifest);
    if (manifestErrors.length > 0) {
        throw new Error(
            ['Invalid Linux frame-copy build manifest.', ...manifestErrors]
                .map((error) => `- ${error}`)
                .join('\n')
        );
    }
    verifyBundledRuntimeFiles(nativeDir, buildManifest);

    fs.chmodSync(helperPath, 0o755);
    fs.chmodSync(readerPath, 0o644);
    fs.rmSync(path.join(nativeDir, WINDOWS_FRAME_COPY_HELPER), { force: true });
    fs.rmSync(path.join(nativeDir, UNAVAILABLE_MARKER), { force: true });
    if (profile.runtimeMode === 'system') {
        fs.rmSync(path.join(nativeDir, 'lib'), {
            recursive: true,
            force: true,
        });
        removeLinuxRuntimeNotices(nativeDir);
    } else {
        prepareBundledLinuxRuntimeNotices(
            nativeDir,
            buildManifest.sourceRuntime,
            options.noticeSourceDir
        );
    }

    return writeManifest(
        nativeDir,
        createPackagedManifest(buildManifest, profile, targetNames)
    );
}

function preparePackagedFrameCopyArtifacts(nativeDir, platform, options = {}) {
    if (platform === 'linux') {
        return prepareLinuxFrameCopyArtifacts(nativeDir, options);
    }

    const helperPath = path.join(
        nativeDir,
        platform === 'win32' ? WINDOWS_FRAME_COPY_HELPER : FRAME_COPY_HELPER
    );

    if (platform !== 'win32' && fs.existsSync(helperPath)) {
        // Asset copying drops POSIX modes; restore spawn permission.
        fs.chmodSync(helperPath, 0o755);
    }
    return undefined;
}

function removeStaleFrameCopyArtifacts(nativeDir) {
    for (const fileName of [
        FRAME_COPY_HELPER,
        WINDOWS_FRAME_COPY_HELPER,
        FRAME_COPY_READER,
    ]) {
        fs.rmSync(path.join(nativeDir, fileName), { force: true });
    }
    removeLinuxRuntimeNotices(nativeDir);
}

module.exports = {
    preparePackagedFrameCopyArtifacts,
    removeStaleFrameCopyArtifacts,
    validateLinuxFrameCopyBuildManifest,
};
