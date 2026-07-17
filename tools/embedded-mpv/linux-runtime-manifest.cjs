'use strict';

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const {
    EXTERNAL_SYSTEM_LIBRARIES,
    EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES,
    GLIBC_TOOLCHAIN_ALLOWLIST,
    MINIMUM_TOOL_VERSIONS,
    PORTABLE_ABI_BASELINE,
    REQUIRED_TOOLS,
    RUNTIME_EXTERNAL_CONFIGURATION,
    SOURCE_PACKAGES,
    compareVersions,
    parseVersion,
} = require('./build-linux-runtime.cjs');

const LINUX_RUNTIME_MANIFEST_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9_+.-]+$/;
const SHARED_LIBRARY_PATTERN = /\.so(?:\.\d+)*$/;
const VERSIONED_LIBMPV_PATTERN = /^libmpv\.so\.\d+(?:\.\d+)*$/;
const REQUIRED_SOURCE_PACKAGES = SOURCE_PACKAGES.map(({ id }) => id);
const SOURCE_PACKAGE_BY_ID = new Map(
    SOURCE_PACKAGES.map((sourcePackage) => [sourcePackage.id, sourcePackage])
);
const ALLOWED_EXTERNAL_LIBRARY_NAMES = new Set([
    ...GLIBC_TOOLCHAIN_ALLOWLIST,
    ...EXTERNAL_SYSTEM_LIBRARIES.map(({ name }) => name),
]);
const SUBMODULE_RECORD_PATTERN =
    /^[a-f0-9]{40,64}\s+([A-Za-z0-9_+./-]+)(?:\s+\(.+\))?$/;
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

function isValidSubmoduleRecord(value) {
    if (typeof value !== 'string') {
        return false;
    }
    const match = value.match(SUBMODULE_RECORD_PATTERN);
    if (!match) {
        return false;
    }
    const submodulePath = match[1];
    return (
        !path.posix.isAbsolute(submodulePath) &&
        !submodulePath
            .split('/')
            .some((segment) => segment === '.' || segment === '..')
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
        if (!SOURCE_PACKAGE_BY_ID.has(packageName)) {
            errors.push(
                `Linux runtime manifest packages contains unexpected source package "${packageName}".`
            );
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

        const pinnedPackage = SOURCE_PACKAGE_BY_ID.get(packageName);
        if (!pinnedPackage) {
            continue;
        }

        for (const field of ['version', 'sourceUrl', 'license']) {
            if (
                isNonEmptyString(packageMetadata[field]) &&
                packageMetadata[field] !== pinnedPackage[field]
            ) {
                errors.push(
                    `Linux runtime manifest ${label}.${field} must equal the pinned value.`
                );
            }
        }

        if (pinnedPackage.sourceTag) {
            if (packageMetadata.sourceTag !== pinnedPackage.sourceTag) {
                errors.push(
                    `Linux runtime manifest ${label}.sourceTag must equal the pinned tag.`
                );
            }
        } else if (packageMetadata.sourceTag !== undefined) {
            errors.push(
                `Linux runtime manifest ${label} must not include sourceTag.`
            );
        }

        if (pinnedPackage.buildInput) {
            if (
                !isObject(packageMetadata.buildInput) ||
                !isDeepStrictEqual(
                    packageMetadata.buildInput,
                    pinnedPackage.buildInput
                )
            ) {
                errors.push(
                    `Linux runtime manifest ${label}.buildInput must equal the pinned build input.`
                );
            }
        } else if (packageMetadata.buildInput !== undefined) {
            errors.push(
                `Linux runtime manifest ${label} must not include buildInput.`
            );
        }

        if (pinnedPackage.sourceKind === 'archive') {
            if (
                typeof packageMetadata.sourceSha256 === 'string' &&
                SHA256_PATTERN.test(packageMetadata.sourceSha256) &&
                packageMetadata.sourceSha256 !== pinnedPackage.expectedSha256
            ) {
                errors.push(
                    `Linux runtime manifest ${label}.sourceSha256 must equal the pinned digest.`
                );
            }
            if (packageMetadata.sourceGitCommit !== undefined) {
                errors.push(
                    `Linux runtime manifest ${label} must not include sourceGitCommit.`
                );
            }
            if (packageMetadata.sourceSubmodules !== undefined) {
                errors.push(
                    `Linux runtime manifest ${label} must not include sourceSubmodules.`
                );
            }
            continue;
        }

        if (
            typeof packageMetadata.sourceGitCommit === 'string' &&
            GIT_COMMIT_PATTERN.test(packageMetadata.sourceGitCommit) &&
            packageMetadata.sourceGitCommit !== pinnedPackage.expectedGitCommit
        ) {
            errors.push(
                `Linux runtime manifest ${label}.sourceGitCommit must equal the pinned commit.`
            );
        }
        if (packageMetadata.sourceSha256 !== undefined) {
            errors.push(
                `Linux runtime manifest ${label} must not include sourceSha256.`
            );
        }
        if (
            !Array.isArray(packageMetadata.sourceSubmodules) ||
            packageMetadata.sourceSubmodules.length === 0 ||
            packageMetadata.sourceSubmodules.some(
                (record) => !isValidSubmoduleRecord(record)
            ) ||
            new Set(packageMetadata.sourceSubmodules).size !==
                packageMetadata.sourceSubmodules.length
        ) {
            errors.push(
                `Linux runtime manifest ${label}.sourceSubmodules must be a non-empty array of commit-and-path records.`
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
        const assignmentsByOption = new Map();
        for (const flag of mpv.mesonFlags) {
            const match =
                typeof flag === 'string' ? flag.match(/^(-D[^=]+)=/) : null;
            if (!match) {
                continue;
            }
            const option = match[1];
            const assignments = assignmentsByOption.get(option) ?? [];
            assignments.push(flag);
            assignmentsByOption.set(option, assignments);
        }
        for (const [option, assignments] of assignmentsByOption) {
            if (assignments.length > 1) {
                errors.push(
                    `Linux runtime manifest mpv.mesonFlags must assign "${option}" exactly once.`
                );
            }
        }

        for (const [option, requiredFlag] of [
            ['-Dgpl', '-Dgpl=false'],
            ['-Dlibmpv', '-Dlibmpv=true'],
        ]) {
            const assignments = assignmentsByOption.get(option) ?? [];
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
    let hasLibMpvLinkerAlias = false;
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
            if (name === 'libmpv.so') {
                hasLibMpvLinkerAlias = true;
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
    if (!hasLibMpvLinkerAlias) {
        errors.push(
            'Linux runtime manifest runtimeFiles must include the libmpv.so linker alias.'
        );
    }
}

function validateRuntimeTotalBytes(errors, runtimeFiles, runtimeTotalBytes) {
    const expectedTotal = Array.isArray(runtimeFiles)
        ? runtimeFiles.reduce(
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
    if (
        !Number.isInteger(runtimeTotalBytes) ||
        runtimeTotalBytes !== expectedTotal
    ) {
        errors.push(
            `Linux runtime manifest runtimeTotalBytes must equal the sum of runtimeFiles sizes (${expectedTotal}).`
        );
    }
}

function validateRuntimeAbi(errors, runtimeAbi, runtimeFiles) {
    if (!isObject(runtimeAbi)) {
        errors.push('Linux runtime manifest runtimeAbi must be an object.');
        return;
    }
    if (
        !isObject(runtimeAbi.baseline) ||
        !isDeepStrictEqual(runtimeAbi.baseline, PORTABLE_ABI_BASELINE)
    ) {
        errors.push(
            'Linux runtime manifest runtimeAbi.baseline must exactly match the portable ABI baseline.'
        );
    }

    const runtimeNames = Array.isArray(runtimeFiles)
        ? runtimeFiles
              .filter((runtimeFile) => isObject(runtimeFile))
              .map(({ name }) => name)
              .filter((name) => typeof name === 'string')
        : [];
    const runtimeNameSet = new Set(runtimeNames);
    if (!Array.isArray(runtimeAbi.files)) {
        errors.push(
            'Linux runtime manifest runtimeAbi.files must contain one record for every runtime file.'
        );
        return;
    }

    const abiNames = new Set();
    for (const [index, record] of runtimeAbi.files.entries()) {
        const label = `runtimeAbi.files[${index}]`;
        if (!isObject(record)) {
            errors.push(`Linux runtime manifest ${label} must be an object.`);
            continue;
        }
        if (
            !isSafeBasename(record.name) ||
            !SHARED_LIBRARY_PATTERN.test(record.name)
        ) {
            errors.push(
                `Linux runtime manifest ${label}.name must be a safe shared-library basename.`
            );
        }
        if (abiNames.has(record.name)) {
            errors.push(
                `Linux runtime manifest runtimeAbi.files contains duplicate name "${String(
                    record.name
                )}".`
            );
        } else if (typeof record.name === 'string') {
            abiNames.add(record.name);
        }

        for (const [field, maximum] of [
            ['requiredGlibc', PORTABLE_ABI_BASELINE.glibcMaximum],
            ['requiredGlibcxx', PORTABLE_ABI_BASELINE.glibcxxMaximum],
        ]) {
            const version = record[field];
            if (
                version !== null &&
                (typeof version !== 'string' ||
                    !/^\d+(?:\.\d+)+$/.test(version))
            ) {
                errors.push(
                    `Linux runtime manifest ${label}.${field} must be null or a dotted numeric symbol version.`
                );
                continue;
            }
            if (version && compareVersions(version, maximum) > 0) {
                errors.push(
                    `Linux runtime manifest ${label}.${field} must not exceed portable ABI maximum ${maximum}.`
                );
            }
        }
    }

    if (
        runtimeAbi.files.length !== runtimeNames.length ||
        runtimeNames.some((name) => !abiNames.has(name)) ||
        [...abiNames].some((name) => !runtimeNameSet.has(name))
    ) {
        errors.push(
            'Linux runtime manifest runtimeAbi.files must contain one record for every runtime file.'
        );
    }
}

function validateRuntimeExternalConfiguration(
    errors,
    runtimeExternalConfiguration
) {
    if (
        !isObject(runtimeExternalConfiguration) ||
        !isDeepStrictEqual(
            runtimeExternalConfiguration,
            RUNTIME_EXTERNAL_CONFIGURATION
        )
    ) {
        errors.push(
            'Linux runtime manifest runtimeExternalConfiguration must exactly match the system-owned runtime paths.'
        );
    }
}

function validateRuntimeDependencyClosure(
    errors,
    runtimeDependencyClosure,
    runtimeFiles
) {
    if (!isObject(runtimeDependencyClosure)) {
        errors.push(
            'Linux runtime manifest runtimeDependencyClosure must be an object.'
        );
        return;
    }

    const runtimeNames = Array.isArray(runtimeFiles)
        ? runtimeFiles
              .filter((runtimeFile) => isObject(runtimeFile))
              .map(({ name }) => name)
              .filter((name) => typeof name === 'string')
        : [];
    const runtimeNameSet = new Set(runtimeNames);
    const { entries, externalDependencies } = runtimeDependencyClosure;

    if (!Array.isArray(entries)) {
        errors.push(
            'Linux runtime manifest runtimeDependencyClosure.entries must contain one record for every runtime file.'
        );
        return;
    }

    const entryNames = new Set();
    const computedExternalDependencies = new Set();
    for (const [index, entry] of entries.entries()) {
        const label = `runtimeDependencyClosure.entries[${index}]`;
        if (!isObject(entry)) {
            errors.push(`Linux runtime manifest ${label} must be an object.`);
            continue;
        }

        if (
            !isSafeBasename(entry.name) ||
            !SHARED_LIBRARY_PATTERN.test(entry.name)
        ) {
            errors.push(
                `Linux runtime manifest ${label}.name must be a safe shared-library basename.`
            );
        }
        if (entryNames.has(entry.name)) {
            errors.push(
                `Linux runtime manifest runtimeDependencyClosure.entries contains duplicate name "${String(
                    entry.name
                )}".`
            );
        } else if (typeof entry.name === 'string') {
            entryNames.add(entry.name);
        }

        if (
            entry.soname !== null &&
            (!isSafeBasename(entry.soname) ||
                !SHARED_LIBRARY_PATTERN.test(entry.soname))
        ) {
            errors.push(
                `Linux runtime manifest ${label}.soname must be null or a safe shared-library basename.`
            );
        }

        if (
            !Array.isArray(entry.needed) ||
            entry.needed.some(
                (dependencyName) =>
                    !isSafeBasename(dependencyName) ||
                    !SHARED_LIBRARY_PATTERN.test(dependencyName)
            )
        ) {
            errors.push(
                `Linux runtime manifest ${label}.needed must be an array of safe shared-library names.`
            );
        } else {
            const neededNames = new Set();
            for (const dependencyName of entry.needed) {
                if (neededNames.has(dependencyName)) {
                    errors.push(
                        `Linux runtime manifest ${label}.needed contains duplicate name "${dependencyName}".`
                    );
                    continue;
                }
                neededNames.add(dependencyName);
                if (runtimeNameSet.has(dependencyName)) {
                    continue;
                }
                if (!ALLOWED_EXTERNAL_LIBRARY_NAMES.has(dependencyName)) {
                    errors.push(
                        `Linux runtime manifest dependency ${dependencyName} is not in the deterministic system-library allowlist.`
                    );
                    continue;
                }
                computedExternalDependencies.add(dependencyName);
            }
        }

        if (!Array.isArray(entry.rpath) || entry.rpath.length !== 0) {
            errors.push(
                `Linux runtime manifest ${label}.rpath must be an empty array.`
            );
        }
        if (
            !Array.isArray(entry.runpath) ||
            entry.runpath.length !== 1 ||
            entry.runpath[0] !== '$ORIGIN'
        ) {
            errors.push(
                `Linux runtime manifest ${label}.runpath must contain only "$ORIGIN".`
            );
        }
    }

    if (
        entries.length !== runtimeNames.length ||
        runtimeNames.some((name) => !entryNames.has(name)) ||
        [...entryNames].some((name) => !runtimeNameSet.has(name))
    ) {
        errors.push(
            'Linux runtime manifest runtimeDependencyClosure.entries must contain one record for every runtime file.'
        );
    }

    const libMpvLinkerEntry = entries.find(
        (entry) => isObject(entry) && entry.name === 'libmpv.so'
    );
    if (
        !libMpvLinkerEntry ||
        typeof libMpvLinkerEntry.soname !== 'string' ||
        !VERSIONED_LIBMPV_PATTERN.test(libMpvLinkerEntry.soname) ||
        !runtimeNameSet.has(libMpvLinkerEntry.soname)
    ) {
        errors.push(
            'Linux runtime manifest libmpv.so must declare a versioned SONAME present in runtimeFiles.'
        );
    }

    const expectedExternalDependencies = [
        ...computedExternalDependencies,
    ].sort();
    if (
        !Array.isArray(externalDependencies) ||
        externalDependencies.some(
            (dependencyName) =>
                !isSafeBasename(dependencyName) ||
                !SHARED_LIBRARY_PATTERN.test(dependencyName)
        ) ||
        JSON.stringify(externalDependencies) !==
            JSON.stringify(expectedExternalDependencies)
    ) {
        errors.push(
            'Linux runtime manifest runtimeDependencyClosure.externalDependencies must exactly match the sorted allowlisted external dependency set.'
        );
    }
}

function validateExternalSystemLibraries(errors, externalSystemLibraries) {
    const expectedKeys = ['interface', 'name', 'reason'];
    const matchesDeterministicAllowlist =
        Array.isArray(externalSystemLibraries) &&
        externalSystemLibraries.length === EXTERNAL_SYSTEM_LIBRARIES.length &&
        externalSystemLibraries.every((externalLibrary, index) => {
            if (!isObject(externalLibrary)) {
                return false;
            }
            const actualKeys = Object.keys(externalLibrary).sort();
            if (
                actualKeys.length !== expectedKeys.length ||
                actualKeys.some(
                    (key, keyIndex) => key !== expectedKeys[keyIndex]
                )
            ) {
                return false;
            }
            const expectedLibrary = EXTERNAL_SYSTEM_LIBRARIES[index];
            return expectedKeys.every(
                (key) => externalLibrary[key] === expectedLibrary[key]
            );
        });
    if (!matchesDeterministicAllowlist) {
        errors.push(
            'Linux runtime manifest externalSystemLibraries must exactly match the deterministic allowlist.'
        );
    }
}

function validateBuildHost(errors, buildHost) {
    if (!isObject(buildHost)) {
        errors.push('Linux runtime manifest buildHost must be an object.');
        return;
    }
    if (buildHost.platform !== 'linux') {
        errors.push(
            'Linux runtime manifest buildHost.platform must be "linux".'
        );
    }
    if (buildHost.arch !== 'x64') {
        errors.push('Linux runtime manifest buildHost.arch must be "x64".');
    }
    if (!isNonEmptyString(buildHost.release)) {
        errors.push(
            'Linux runtime manifest buildHost.release must be a non-empty string.'
        );
    }
    if (
        typeof buildHost.glibcVersion !== 'string' ||
        !/^\d+(?:\.\d+)+$/.test(buildHost.glibcVersion)
    ) {
        errors.push(
            'Linux runtime manifest buildHost.glibcVersion must be a dotted numeric version.'
        );
    } else if (
        compareVersions(
            buildHost.glibcVersion,
            PORTABLE_ABI_BASELINE.glibcMaximum
        ) > 0
    ) {
        errors.push(
            `Linux runtime manifest buildHost.glibcVersion ${buildHost.glibcVersion} exceeds portable ABI baseline maximum ${PORTABLE_ABI_BASELINE.glibcMaximum}.`
        );
    }

    if (
        !Array.isArray(buildHost.systemPkgConfigDirs) ||
        buildHost.systemPkgConfigDirs.length === 0 ||
        buildHost.systemPkgConfigDirs.some(
            (directory) =>
                !isNonEmptyString(directory) || !path.isAbsolute(directory)
        ) ||
        new Set(buildHost.systemPkgConfigDirs).size !==
            buildHost.systemPkgConfigDirs.length
    ) {
        errors.push(
            'Linux runtime manifest buildHost.systemPkgConfigDirs must be a non-empty array of unique absolute paths.'
        );
    }

    if (!isObject(buildHost.systemPkgConfigPackages)) {
        errors.push(
            'Linux runtime manifest buildHost.systemPkgConfigPackages must be an object.'
        );
    } else {
        for (const packageName of EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES) {
            if (
                !isNonEmptyString(
                    buildHost.systemPkgConfigPackages[packageName]
                )
            ) {
                errors.push(
                    `Linux runtime manifest buildHost.systemPkgConfigPackages.${packageName} must be a non-empty version string.`
                );
            }
        }
        for (const packageName of Object.keys(
            buildHost.systemPkgConfigPackages
        ).sort()) {
            if (!EXPECTED_SYSTEM_PKG_CONFIG_PACKAGES.includes(packageName)) {
                errors.push(
                    `Linux runtime manifest buildHost.systemPkgConfigPackages contains unexpected package "${packageName}".`
                );
            }
        }
    }

    if (!isObject(buildHost.tools)) {
        errors.push(
            'Linux runtime manifest buildHost.tools must be an object.'
        );
        return;
    }
    for (const tool of REQUIRED_TOOLS) {
        const declaredVersion = buildHost.tools[tool];
        if (!isNonEmptyString(declaredVersion)) {
            errors.push(
                `Linux runtime manifest buildHost.tools.${tool} must be a non-empty version string.`
            );
            continue;
        }
        const actualVersion = parseVersion(declaredVersion);
        if (!actualVersion) {
            errors.push(
                `Linux runtime manifest buildHost.tools.${tool} must contain a parseable dotted numeric version.`
            );
        } else if (
            compareVersions(actualVersion, MINIMUM_TOOL_VERSIONS[tool]) < 0
        ) {
            errors.push(
                `Linux runtime manifest buildHost.tools.${tool} ${actualVersion} is unsupported; requires ${MINIMUM_TOOL_VERSIONS[tool]} or newer.`
            );
        }
    }
    for (const tool of Object.keys(buildHost.tools).sort()) {
        if (!REQUIRED_TOOLS.includes(tool)) {
            errors.push(
                `Linux runtime manifest buildHost.tools contains unexpected tool "${tool}".`
            );
        }
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
    } else {
        for (const [sourceName, sourcePattern] of [
            ['hwdata', /\bhwdata\b/i],
            ['pnp.ids', /\bpnp\.ids\b/i],
            ['libdisplay-info', /\blibdisplay-info\b/i],
        ]) {
            if (!sourcePattern.test(manifest.sourceDistribution)) {
                errors.push(
                    `Linux runtime manifest sourceDistribution must explicitly include ${sourceName}.`
                );
            }
        }
    }

    validateRuntimeFiles(errors, manifest.runtimeFiles);
    validateRuntimeTotalBytes(
        errors,
        manifest.runtimeFiles,
        manifest.runtimeTotalBytes
    );
    validateRuntimeAbi(errors, manifest.runtimeAbi, manifest.runtimeFiles);
    validateRuntimeExternalConfiguration(
        errors,
        manifest.runtimeExternalConfiguration
    );
    validateRuntimeDependencyClosure(
        errors,
        manifest.runtimeDependencyClosure,
        manifest.runtimeFiles
    );
    validateExternalSystemLibraries(errors, manifest.externalSystemLibraries);
    validateBuildHost(errors, manifest.buildHost);
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
