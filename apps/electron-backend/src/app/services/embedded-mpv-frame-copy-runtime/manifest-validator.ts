import { isDeepStrictEqual } from 'util';
import {
    BASE_MANIFEST_FIELDS,
    BUNDLED_MANIFEST_FIELDS,
    DEVELOPMENT_MANIFEST_FIELDS,
    EXPECTED_ARTIFACTS,
    EXPECTED_DEVELOPMENT_ARTIFACTS,
    EXPECTED_DEVELOPMENT_PROCESS_ISOLATION,
    EXPECTED_PROCESS_ISOLATION,
    PROFILE_CONTRACTS,
    validateLinuxSourceArchiveBinding,
    SYSTEM_PACKAGE_DEPENDENCIES,
    VERSIONED_LIBMPV_PATTERN,
} from './contracts';
import { validateRuntimeClosure } from './runtime-closure-validator';
import { validateSourceRuntimePolicy } from './source-runtime-validator';
import type { RuntimeProfile, ValidManifest, ValidationResult } from './types';
import {
    hasExactFields,
    isObject,
    validateRuntimeFiles,
    validateTargets,
    validationFailure,
} from './validation-primitives';

export function validatePackagedManifest(
    manifest: Record<string, unknown>
): ValidationResult<ValidManifest> {
    if (
        manifest.schemaVersion !== 1 ||
        manifest.platform !== 'linux' ||
        manifest.arch !== 'x64' ||
        typeof manifest.profile !== 'string' ||
        !Object.prototype.hasOwnProperty.call(
            PROFILE_CONTRACTS,
            manifest.profile
        )
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    const profile = manifest.profile as RuntimeProfile;
    const contract = PROFILE_CONTRACTS[profile];
    if (
        manifest.origin !== contract.origin ||
        manifest.runtimeMode !== contract.runtimeMode ||
        !hasExactFields(
            manifest,
            contract.runtimeMode === 'bundled'
                ? BUNDLED_MANIFEST_FIELDS
                : BASE_MANIFEST_FIELDS
        ) ||
        typeof manifest.generatedAt !== 'string' ||
        manifest.generatedAt.trim() === '' ||
        Number.isNaN(Date.parse(manifest.generatedAt)) ||
        !validateTargets(manifest.targets, contract.targets) ||
        !isDeepStrictEqual(manifest.artifacts, EXPECTED_ARTIFACTS) ||
        !isDeepStrictEqual(
            manifest.processIsolation,
            EXPECTED_PROCESS_ISOLATION
        ) ||
        manifest.nativeViewFallback !== 'process-isolated mpv --wid' ||
        typeof manifest.libmpvSoname !== 'string' ||
        !VERSIONED_LIBMPV_PATTERN.test(manifest.libmpvSoname)
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    if (contract.runtimeMode === 'system') {
        if (
            !isDeepStrictEqual(
                manifest.packageDependencies,
                SYSTEM_PACKAGE_DEPENDENCIES
            ) ||
            !isDeepStrictEqual(manifest.runtimeFiles, []) ||
            manifest.runtimeTotalBytes !== 0
        ) {
            return validationFailure('runtime-manifest-invalid');
        }
        return {
            value: {
                profile,
                runtimeMode: 'system',
                runtimeFiles: [],
            },
        };
    }

    const runtimeFiles = validateRuntimeFiles(manifest.runtimeFiles);
    if (
        !runtimeFiles ||
        !isDeepStrictEqual(manifest.packageDependencies, {}) ||
        !runtimeFiles.some(({ name }) => name === 'libmpv.so') ||
        !runtimeFiles.some(({ name }) => name === manifest.libmpvSoname) ||
        manifest.runtimeTotalBytes !==
            runtimeFiles.reduce(
                (total, runtimeFile) => total + runtimeFile.size,
                0
            ) ||
        !validateRuntimeClosure(
            manifest.runtimeDependencyClosure,
            runtimeFiles,
            manifest.libmpvSoname,
            manifest.externalSystemLibraries
        ) ||
        validateLinuxSourceArchiveBinding(manifest.sourceArchive).length !==
            0 ||
        !validateSourceRuntimePolicy(
            manifest.sourceRuntime,
            runtimeFiles,
            manifest.runtimeDependencyClosure,
            manifest.externalSystemLibraries
        )
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    return {
        value: {
            profile,
            runtimeMode: 'bundled',
            runtimeFiles,
        },
    };
}

function validateSystemDevelopmentSource(
    value: unknown,
    buildInputMode: 'system-dev' | 'system-build-inputs'
): boolean {
    if (buildInputMode === 'system-dev') {
        return isDeepStrictEqual(value, {
            linuxBackend: 'process-isolated mpv --wid',
            warning: 'Development-only unmanaged system libmpv toolchain.',
        });
    }
    if (
        !isObject(value) ||
        !hasExactFields(value, [
            'buildInputs',
            'linuxBackend',
            'sourceDistribution',
        ]) ||
        value.linuxBackend !== 'process-isolated mpv --wid' ||
        typeof value.sourceDistribution !== 'string' ||
        value.sourceDistribution.trim() === '' ||
        !isObject(value.buildInputs) ||
        !hasExactFields(value.buildInputs, ['libmpvDevPackage', 'mpvPackage'])
    ) {
        return false;
    }
    return ['libmpvDevPackage', 'mpvPackage'].every((packageField) => {
        const packageName = value.buildInputs[packageField];
        return typeof packageName === 'string' && packageName.trim().length > 0;
    });
}

export function validateDevelopmentManifest(
    manifest: Record<string, unknown>
): ValidationResult<ValidManifest> {
    const buildInputMode = manifest.buildInputMode;
    if (
        !hasExactFields(manifest, DEVELOPMENT_MANIFEST_FIELDS) ||
        manifest.schemaVersion !== 1 ||
        manifest.origin !== 'linux-frame-copy-build' ||
        manifest.platform !== 'linux' ||
        manifest.arch !== 'x64' ||
        typeof manifest.generatedAt !== 'string' ||
        manifest.generatedAt.trim() === '' ||
        Number.isNaN(Date.parse(manifest.generatedAt)) ||
        !['system-dev', 'system-build-inputs', 'bundled-runtime'].includes(
            String(buildInputMode)
        ) ||
        !isDeepStrictEqual(manifest.allowedPackageRuntimeModes, [
            'system',
            'bundled',
        ]) ||
        !isDeepStrictEqual(
            manifest.artifacts,
            EXPECTED_DEVELOPMENT_ARTIFACTS
        ) ||
        !isDeepStrictEqual(
            manifest.processIsolation,
            EXPECTED_DEVELOPMENT_PROCESS_ISOLATION
        ) ||
        manifest.nativeViewFallback !== 'process-isolated mpv --wid'
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    if (
        buildInputMode === 'system-dev' ||
        buildInputMode === 'system-build-inputs'
    ) {
        if (
            manifest.sourceRuntimeValidated !== false ||
            !isDeepStrictEqual(manifest.packageRuntimeAvailability, {
                system: false,
                bundled: false,
            }) ||
            manifest.libmpvSoname !== null ||
            !isDeepStrictEqual(manifest.runtimeFiles, []) ||
            manifest.runtimeTotalBytes !== 0 ||
            manifest.sourceArchive !== null ||
            !validateSystemDevelopmentSource(
                manifest.sourceRuntime,
                buildInputMode
            )
        ) {
            return validationFailure('runtime-manifest-invalid');
        }
        return {
            value: {
                profile: 'development',
                runtimeMode: 'system',
                runtimeFiles: [],
            },
        };
    }

    const sourceRuntime = manifest.sourceRuntime;
    const runtimeFiles = validateRuntimeFiles(manifest.runtimeFiles);
    if (
        buildInputMode !== 'bundled-runtime' ||
        manifest.sourceRuntimeValidated !== true ||
        !isDeepStrictEqual(manifest.packageRuntimeAvailability, {
            system: true,
            bundled: true,
        }) ||
        typeof manifest.libmpvSoname !== 'string' ||
        !VERSIONED_LIBMPV_PATTERN.test(manifest.libmpvSoname) ||
        !runtimeFiles ||
        !runtimeFiles.some(({ name }) => name === 'libmpv.so') ||
        !runtimeFiles.some(({ name }) => name === manifest.libmpvSoname) ||
        manifest.runtimeTotalBytes !==
            runtimeFiles.reduce(
                (total, runtimeFile) => total + runtimeFile.size,
                0
            ) ||
        !isObject(sourceRuntime) ||
        (manifest.sourceArchive !== null &&
            validateLinuxSourceArchiveBinding(manifest.sourceArchive).length !==
                0) ||
        !validateRuntimeClosure(
            sourceRuntime.runtimeDependencyClosure,
            runtimeFiles,
            manifest.libmpvSoname,
            sourceRuntime.externalSystemLibraries
        ) ||
        !validateSourceRuntimePolicy(
            sourceRuntime,
            runtimeFiles,
            sourceRuntime.runtimeDependencyClosure,
            sourceRuntime.externalSystemLibraries
        )
    ) {
        return validationFailure('runtime-manifest-invalid');
    }

    return {
        value: {
            profile: 'development',
            runtimeMode: 'bundled',
            runtimeFiles,
        },
    };
}
