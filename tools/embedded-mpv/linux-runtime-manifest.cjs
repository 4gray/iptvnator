'use strict';

const path = require('node:path');

const LINUX_RUNTIME_MANIFEST_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9_+.-]+$/;
const SHARED_LIBRARY_PATTERN = /\.so(?:\.\d+)*$/;
const VERSIONED_LIBMPV_PATTERN = /^libmpv\.so\.\d+(?:\.\d+)*$/;
const REQUIRED_SOURCE_PACKAGES = ['ffmpeg', 'mpv'];
const LINUX_SYSTEM_BACKEND = 'process-isolated mpv --wid';

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isSafeBasename(value) {
    return (
        isNonEmptyString(value) &&
        path.basename(value) === value &&
        !value.includes('/') &&
        !value.includes('\\') &&
        value !== '.' &&
        value !== '..' &&
        SAFE_BASENAME_PATTERN.test(value)
    );
}

function validateSourceMetadata(errors, value, label) {
    if (!isNonEmptyString(value.version)) {
        errors.push(
            `Linux runtime manifest ${label}.version must be a non-empty string.`
        );
    }
    if (!isNonEmptyString(value.sourceUrl)) {
        errors.push(
            `Linux runtime manifest ${label}.sourceUrl must be a non-empty string.`
        );
    }

    const hasSourceSha256 = value.sourceSha256 !== undefined;
    const hasSourceGitCommit = value.sourceGitCommit !== undefined;
    if (!hasSourceSha256 && !hasSourceGitCommit) {
        errors.push(
            `Linux runtime manifest ${label} must include sourceSha256 or sourceGitCommit.`
        );
        return;
    }
    if (
        hasSourceSha256 &&
        (typeof value.sourceSha256 !== 'string' ||
            !SHA256_PATTERN.test(value.sourceSha256))
    ) {
        errors.push(
            `Linux runtime manifest ${label}.sourceSha256 must be a lowercase 64-character hexadecimal digest.`
        );
    }
    if (
        hasSourceGitCommit &&
        (typeof value.sourceGitCommit !== 'string' ||
            !GIT_COMMIT_PATTERN.test(value.sourceGitCommit))
    ) {
        errors.push(
            `Linux runtime manifest ${label}.sourceGitCommit must be a lowercase hexadecimal commit digest.`
        );
    }
}

function validatePackages(errors, packages) {
    if (!isObject(packages)) {
        errors.push(
            'Linux runtime manifest packages must contain source package metadata.'
        );
        return;
    }

    if (Object.keys(packages).length === 0) {
        errors.push(
            'Linux runtime manifest packages must contain source package metadata.'
        );
    }

    const invalidRequiredPackages = new Set();
    for (const packageName of REQUIRED_SOURCE_PACKAGES) {
        if (
            !Object.prototype.hasOwnProperty.call(packages, packageName) ||
            !isObject(packages[packageName])
        ) {
            errors.push(
                `Linux runtime manifest packages.${packageName} must be an object.`
            );
            invalidRequiredPackages.add(packageName);
        }
    }

    for (const packageName of Object.keys(packages).sort()) {
        const packageMetadata = packages[packageName];
        const label = `packages.${packageName}`;
        if (!isObject(packageMetadata)) {
            if (!invalidRequiredPackages.has(packageName)) {
                errors.push(
                    `Linux runtime manifest ${label} must be an object.`
                );
            }
            continue;
        }

        validateSourceMetadata(errors, packageMetadata, label);
        if (!isNonEmptyString(packageMetadata.license)) {
            errors.push(
                `Linux runtime manifest ${label}.license must be a non-empty string.`
            );
        }
    }
}

function validateFlags(errors, value, label, options) {
    if (
        !Array.isArray(value) ||
        value.some((flag) => typeof flag !== 'string')
    ) {
        errors.push(
            `Linux runtime manifest ${label} must be an array of strings.`
        );
        return;
    }

    const addForbiddenErrors = () => {
        for (const forbiddenFlag of options.forbidden) {
            if (value.includes(forbiddenFlag)) {
                errors.push(
                    `Linux runtime manifest ${label} must not include "${forbiddenFlag}".`
                );
            }
        }
    };
    const addRequiredErrors = () => {
        for (const requiredFlag of options.required) {
            if (!value.includes(requiredFlag)) {
                errors.push(
                    `Linux runtime manifest ${label} must include "${requiredFlag}".`
                );
            }
        }
    };

    if (options.requiredFirst) {
        addRequiredErrors();
        addForbiddenErrors();
    } else {
        addForbiddenErrors();
        addRequiredErrors();
    }
}

function validateFfmpeg(errors, ffmpeg) {
    if (!isObject(ffmpeg)) {
        errors.push('Linux runtime manifest ffmpeg must be an object.');
        return;
    }

    validateFlags(errors, ffmpeg.configureFlags, 'ffmpeg.configureFlags', {
        forbidden: ['--enable-gpl', '--enable-nonfree'],
        required: ['--disable-gpl', '--disable-nonfree'],
    });
}

function validateMpv(errors, mpv) {
    if (!isObject(mpv)) {
        errors.push('Linux runtime manifest mpv must be an object.');
        return;
    }

    validateFlags(errors, mpv.mesonFlags, 'mpv.mesonFlags', {
        forbidden: [],
        required: ['-Dgpl=false', '-Dlibmpv=true'],
        requiredFirst: true,
    });

    if (Array.isArray(mpv.mesonFlags)) {
        for (const [option, requiredFlag] of [
            ['-Dgpl', '-Dgpl=false'],
            ['-Dlibmpv', '-Dlibmpv=true'],
        ]) {
            const assignments = mpv.mesonFlags.filter(
                (flag) =>
                    typeof flag === 'string' && flag.startsWith(`${option}=`)
            );
            if (assignments.length > 1) {
                errors.push(
                    `Linux runtime manifest mpv.mesonFlags must assign "${option}" exactly once.`
                );
            }
            for (const flag of assignments) {
                if (flag !== requiredFlag) {
                    errors.push(
                        `Linux runtime manifest mpv.mesonFlags must not include "${flag}".`
                    );
                }
            }
        }
    }
}

function validateRuntimeFiles(errors, runtimeFiles) {
    if (!Array.isArray(runtimeFiles) || runtimeFiles.length === 0) {
        errors.push(
            'Linux runtime manifest runtimeFiles must be a non-empty array.'
        );
        return;
    }

    const names = new Set();
    let hasVersionedLibMpv = false;

    for (const [index, runtimeFile] of runtimeFiles.entries()) {
        const label = `runtimeFiles[${index}]`;
        if (!isObject(runtimeFile)) {
            errors.push(`Linux runtime manifest ${label} must be an object.`);
            continue;
        }

        const { name, sha256, size } = runtimeFile;
        const safeName = isSafeBasename(name);
        if (!safeName) {
            errors.push(
                `Linux runtime manifest ${label}.name must be a safe shared-library basename.`
            );
        }
        if (
            typeof name === 'string' &&
            safeName &&
            !SHARED_LIBRARY_PATTERN.test(name)
        ) {
            errors.push(
                `Linux runtime manifest ${label}.name must end in ".so" or a numeric ".so.N" suffix.`
            );
        }
        if (!Number.isInteger(size) || size <= 0) {
            errors.push(
                `Linux runtime manifest ${label}.size must be a positive integer.`
            );
        }
        if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) {
            errors.push(
                `Linux runtime manifest ${label}.sha256 must be a lowercase 64-character hexadecimal digest.`
            );
        }

        if (typeof name === 'string') {
            if (names.has(name)) {
                errors.push(
                    `Linux runtime manifest runtimeFiles contains duplicate name "${name}".`
                );
            } else {
                names.add(name);
            }
            if (VERSIONED_LIBMPV_PATTERN.test(name)) {
                hasVersionedLibMpv = true;
            }
        }
    }

    if (!hasVersionedLibMpv) {
        errors.push(
            'Linux runtime manifest runtimeFiles must include a versioned libmpv.so.N entry.'
        );
    }
}

function validateLinuxRuntimeManifest(manifest) {
    if (!isObject(manifest)) {
        return ['Linux runtime manifest must be an object.'];
    }

    const errors = [];
    if (manifest.schemaVersion !== LINUX_RUNTIME_MANIFEST_SCHEMA_VERSION) {
        errors.push(
            `Linux runtime manifest schemaVersion must be ${LINUX_RUNTIME_MANIFEST_SCHEMA_VERSION}.`
        );
    }
    if (manifest.origin !== 'vendored-lgpl-source-build') {
        errors.push(
            'Linux runtime manifest origin must be "vendored-lgpl-source-build".'
        );
    }
    if (manifest.platform !== 'linux') {
        errors.push('Linux runtime manifest platform must be "linux".');
    }
    if (manifest.arch !== 'x64') {
        errors.push('Linux runtime manifest arch must be "x64".');
    }

    validatePackages(errors, manifest.packages);
    validateFfmpeg(errors, manifest.ffmpeg);
    validateMpv(errors, manifest.mpv);

    if (!isNonEmptyString(manifest.sourceDistribution)) {
        errors.push(
            'Linux runtime manifest sourceDistribution must be a non-empty string.'
        );
    }

    validateRuntimeFiles(errors, manifest.runtimeFiles);
    return errors;
}

function isLinuxSystemBuildInputManifest(manifest) {
    return isObject(manifest) && manifest.linuxBackend === LINUX_SYSTEM_BACKEND;
}

function validateLinuxSystemBuildInputManifest(manifest) {
    if (!isObject(manifest)) {
        return ['Linux system build-input manifest must be an object.'];
    }

    const errors = [];
    if (manifest.linuxBackend !== LINUX_SYSTEM_BACKEND) {
        errors.push(
            `Linux system build-input manifest linuxBackend must be "${LINUX_SYSTEM_BACKEND}".`
        );
    }

    if (!isObject(manifest.buildInputs)) {
        errors.push(
            'Linux system build-input manifest buildInputs must be an object.'
        );
    } else {
        for (const packageName of ['libmpvDevPackage', 'mpvPackage']) {
            if (!isNonEmptyString(manifest.buildInputs[packageName])) {
                errors.push(
                    `Linux system build-input manifest buildInputs.${packageName} must be a non-empty string.`
                );
            }
        }
    }

    if (!isNonEmptyString(manifest.sourceDistribution)) {
        errors.push(
            'Linux system build-input manifest sourceDistribution must be a non-empty string.'
        );
    }
    if (Object.prototype.hasOwnProperty.call(manifest, 'origin')) {
        errors.push(
            'Linux system build-input manifest must not include origin.'
        );
    }
    if (Object.prototype.hasOwnProperty.call(manifest, 'runtimeFiles')) {
        errors.push(
            'Linux system build-input manifest must not include runtimeFiles.'
        );
    }

    return errors;
}

module.exports = {
    LINUX_SYSTEM_BACKEND,
    LINUX_RUNTIME_MANIFEST_SCHEMA_VERSION,
    isLinuxSystemBuildInputManifest,
    validateLinuxRuntimeManifest,
    validateLinuxSystemBuildInputManifest,
};
