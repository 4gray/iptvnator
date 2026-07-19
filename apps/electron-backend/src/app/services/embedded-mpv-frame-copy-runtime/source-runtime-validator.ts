import path from 'path';
import { isDeepStrictEqual } from 'util';
import {
    GIT_COMMIT_PATTERN,
    PINNED_SOURCE_PACKAGE_IDENTITIES,
    PORTABLE_ABI_BASELINE,
    SUBMODULE_RECORD_PATTERN,
    VERSION_PATTERN,
} from './contracts';
import type { RuntimeFile } from './types';
import {
    hasExactFields,
    isObject,
    isSafeRuntimeName,
} from './validation-primitives';

function compareDottedVersions(left: string, right: string): number {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

function validatesPinnedSourceIdentity(
    candidate: unknown,
    expected: (typeof PINNED_SOURCE_PACKAGE_IDENTITIES)[keyof typeof PINNED_SOURCE_PACKAGE_IDENTITIES]
): boolean {
    if (
        !isObject(candidate) ||
        candidate.version !== expected.version ||
        candidate.sourceUrl !== expected.sourceUrl ||
        candidate.license !== expected.license
    ) {
        return false;
    }
    if (
        ('sourceTag' in expected
            ? candidate.sourceTag !== expected.sourceTag
            : candidate.sourceTag !== undefined) ||
        ('buildInput' in expected
            ? !isDeepStrictEqual(candidate.buildInput, expected.buildInput)
            : candidate.buildInput !== undefined)
    ) {
        return false;
    }
    if ('sourceSha256' in expected) {
        return (
            candidate.sourceSha256 === expected.sourceSha256 &&
            candidate.sourceGitCommit === undefined &&
            candidate.sourceSubmodules === undefined
        );
    }
    return (
        'sourceSubmodules' in expected &&
        candidate.sourceGitCommit === expected.sourceGitCommit &&
        GIT_COMMIT_PATTERN.test(candidate.sourceGitCommit) &&
        candidate.sourceSha256 === undefined &&
        validatesGitSubmoduleRecords(candidate.sourceSubmodules) &&
        isDeepStrictEqual(candidate.sourceSubmodules, expected.sourceSubmodules)
    );
}

function validatesGitSubmoduleRecords(value: unknown): boolean {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        new Set(value).size !== value.length
    ) {
        return false;
    }
    return value.every((record) => {
        if (typeof record !== 'string') {
            return false;
        }
        const match = record.match(SUBMODULE_RECORD_PATTERN);
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
    });
}

function validateStringFlags(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.every(
            (flag) =>
                typeof flag === 'string' &&
                flag.length > 0 &&
                flag.trim() === flag
        ) &&
        new Set(value).size === value.length
    );
}

function validateRuntimeAbi(
    value: unknown,
    runtimeFiles: RuntimeFile[]
): boolean {
    if (
        !isObject(value) ||
        !hasExactFields(value, ['baseline', 'files']) ||
        !isDeepStrictEqual(value.baseline, PORTABLE_ABI_BASELINE) ||
        !Array.isArray(value.files)
    ) {
        return false;
    }

    const abiFileNames: string[] = [];
    for (const record of value.files) {
        if (
            !isObject(record) ||
            !hasExactFields(record, [
                'name',
                'requiredGlibc',
                'requiredGlibcxx',
            ]) ||
            !isSafeRuntimeName(record.name)
        ) {
            return false;
        }
        for (const [field, maximum] of [
            ['requiredGlibc', PORTABLE_ABI_BASELINE.glibcMaximum],
            ['requiredGlibcxx', PORTABLE_ABI_BASELINE.glibcxxMaximum],
        ] as const) {
            const version = record[field];
            if (
                version !== null &&
                (typeof version !== 'string' ||
                    !VERSION_PATTERN.test(version) ||
                    compareDottedVersions(version, maximum) > 0)
            ) {
                return false;
            }
        }
        abiFileNames.push(record.name);
    }

    return isDeepStrictEqual(
        abiFileNames,
        runtimeFiles.map(({ name }) => name)
    );
}

/**
 * The source builder and package verifier own exhaustive build-host, recipe,
 * tool-version, URL and external-configuration validation. Startup repeats
 * only the immutable policy boundary needed before sandbox relaxation:
 * pinned source identities/licenses, LGPL flags, portable ABI, display-data
 * distribution, and the exact runtime closure mirrored by the package.
 */
export function validateSourceRuntimePolicy(
    value: unknown,
    runtimeFiles: RuntimeFile[],
    runtimeDependencyClosure: unknown,
    externalSystemLibraries: unknown
): boolean {
    if (
        !isObject(value) ||
        value.schemaVersion !== 1 ||
        value.origin !== 'vendored-lgpl-source-build' ||
        value.platform !== 'linux' ||
        value.arch !== 'x64' ||
        !isObject(value.packages) ||
        !isObject(value.ffmpeg) ||
        !isObject(value.mpv) ||
        !isDeepStrictEqual(
            Object.keys(value.packages).sort(),
            Object.keys(PINNED_SOURCE_PACKAGE_IDENTITIES).sort()
        )
    ) {
        return false;
    }

    for (const [packageName, expectedIdentity] of Object.entries(
        PINNED_SOURCE_PACKAGE_IDENTITIES
    )) {
        if (
            !validatesPinnedSourceIdentity(
                value.packages[packageName],
                expectedIdentity
            )
        ) {
            return false;
        }
    }

    if (
        !validatesPinnedSourceIdentity(
            value.ffmpeg,
            PINNED_SOURCE_PACKAGE_IDENTITIES.ffmpeg
        ) ||
        !validateStringFlags(value.ffmpeg.configureFlags) ||
        !value.ffmpeg.configureFlags.includes('--disable-gpl') ||
        !value.ffmpeg.configureFlags.includes('--disable-nonfree') ||
        value.ffmpeg.configureFlags.includes('--enable-gpl') ||
        value.ffmpeg.configureFlags.includes('--enable-nonfree') ||
        !validatesPinnedSourceIdentity(
            value.mpv,
            PINNED_SOURCE_PACKAGE_IDENTITIES.mpv
        ) ||
        !validateStringFlags(value.mpv.mesonFlags) ||
        !value.mpv.mesonFlags.includes('-Dgpl=false') ||
        !value.mpv.mesonFlags.includes('-Dlibmpv=true') ||
        value.mpv.mesonFlags.includes('-Dgpl=true')
    ) {
        return false;
    }

    if (
        typeof value.sourceDistribution !== 'string' ||
        !/\bhwdata\b/i.test(value.sourceDistribution) ||
        !/\bpnp\.ids\b/i.test(value.sourceDistribution) ||
        !/\blibdisplay-info\b/i.test(value.sourceDistribution) ||
        value.runtimeTotalBytes !==
            runtimeFiles.reduce(
                (total, runtimeFile) => total + runtimeFile.size,
                0
            ) ||
        !isDeepStrictEqual(value.runtimeFiles, runtimeFiles) ||
        !isDeepStrictEqual(
            value.runtimeDependencyClosure,
            runtimeDependencyClosure
        ) ||
        !isDeepStrictEqual(
            value.externalSystemLibraries,
            externalSystemLibraries
        ) ||
        !validateRuntimeAbi(value.runtimeAbi, runtimeFiles)
    ) {
        return false;
    }

    return true;
}
