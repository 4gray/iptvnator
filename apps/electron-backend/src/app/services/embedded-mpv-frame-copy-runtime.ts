import { spawnSync as nodeSpawnSync } from 'child_process';
import { createHash } from 'crypto';
import * as nodeFileSystem from 'fs';
import { isDeepStrictEqual } from 'util';
import path from 'path';

const RUNTIME_MANIFEST_NAME = 'embedded-mpv-runtime.json';
const FRAME_COPY_ADDON_NAME = 'embedded_mpv.node';
const FRAME_COPY_READER_NAME = 'embedded_mpv_frame_reader.node';
const FRAME_COPY_HELPER_NAME = 'iptvnator_mpv_helper';
const RUNTIME_PROBE_PROTOCOL = 1;
const RUNTIME_PROBE_TIMEOUT_MS = 3000;
const VERSIONED_LIBMPV_PATTERN = /^libmpv\.so\.\d+(?:\.\d+)*$/;
const SAFE_RUNTIME_NAME_PATTERN = /^[A-Za-z0-9_+.-]+$/;
const SHARED_LIBRARY_PATTERN = /\.so(?:\.\d+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const SUBMODULE_RECORD_PATTERN =
    /^[a-f0-9]{40,64}\s+([A-Za-z0-9_+./-]+)(?:\s+\(.+\))?$/;
const VERSION_PATTERN = /^\d+(?:\.\d+)+$/;

const GLIBC_TOOLCHAIN_ALLOWLIST = [
    'ld-linux-x86-64.so.2',
    'libc.so.6',
    'libdl.so.2',
    'libgcc_s.so.1',
    'libm.so.6',
    'libpthread.so.0',
    'librt.so.1',
    'libstdc++.so.6',
] as const;

const EXPECTED_EXTERNAL_SYSTEM_LIBRARIES = [
    {
        name: 'libEGL.so.1',
        interface: 'EGL',
        reason: 'System graphics-driver interface used by the frame-copy helper.',
    },
    {
        name: 'libGL.so.1',
        interface: 'OpenGL',
        reason: 'System OpenGL compatibility interface supplied by the graphics stack.',
    },
    {
        name: 'libGLX.so.0',
        interface: 'OpenGL',
        reason: 'GLVND OpenGL dispatch interface supplied by the graphics stack.',
    },
    {
        name: 'libOpenGL.so.0',
        interface: 'OpenGL',
        reason: 'GLVND OpenGL interface supplied by the graphics stack.',
    },
    {
        name: 'libasound.so.2',
        interface: 'ALSA',
        reason: 'Linux system audio interface intentionally used by libmpv.',
    },
    {
        name: 'libdrm.so.2',
        interface: 'DRM',
        reason: 'Kernel graphics interface used by system GBM and VA-API drivers.',
    },
    {
        name: 'libgbm.so.1',
        interface: 'GBM',
        reason: 'System graphics-buffer interface used by headless EGL rendering.',
    },
    {
        name: 'libpulse.so.0',
        interface: 'PulseAudio',
        reason: 'Linux desktop audio interface intentionally used by libmpv.',
    },
    {
        name: 'libva-drm.so.2',
        interface: 'VA-API DRM',
        reason: 'System VA-API DRM interface used for hardware decoding.',
    },
    {
        name: 'libva.so.2',
        interface: 'VA-API',
        reason: 'System video-acceleration interface used for hardware decoding.',
    },
] as const;

const ALLOWED_EXTERNAL_LIBRARY_NAMES = new Set<string>([
    ...GLIBC_TOOLCHAIN_ALLOWLIST,
    ...EXPECTED_EXTERNAL_SYSTEM_LIBRARIES.map(({ name }) => name),
]);

const PORTABLE_ABI_BASELINE = {
    distribution: 'Ubuntu 22.04',
    glibcMaximum: '2.35',
    glibcxxMaximum: '3.4.30',
} as const;

const PINNED_SOURCE_PACKAGE_IDENTITIES = {
    freetype: {
        version: '2.13.3',
        sourceUrl:
            'https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz',
        sourceSha256:
            '0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289',
        license: 'FreeType License (FTL)',
    },
    fribidi: {
        version: '1.0.16',
        sourceUrl:
            'https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz',
        sourceSha256:
            '1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c',
        license: 'LGPL-2.1-or-later',
    },
    harfbuzz: {
        version: '8.5.0',
        sourceUrl:
            'https://github.com/harfbuzz/harfbuzz/releases/download/8.5.0/harfbuzz-8.5.0.tar.xz',
        sourceSha256:
            '77e4f7f98f3d86bf8788b53e6832fb96279956e1c3961988ea3d4b7ca41ddc27',
        license: 'MIT',
    },
    expat: {
        version: '2.8.2',
        sourceUrl:
            'https://github.com/libexpat/libexpat/releases/download/R_2_8_2/expat-2.8.2.tar.xz',
        sourceSha256:
            '3ad89b8588e6644bd4e49981480d48b21289eebbcd4f0a1a4afb1c29f99b6ab4',
        license: 'MIT',
    },
    fontconfig: {
        version: '2.16.0',
        sourceUrl:
            'https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.16.0.tar.xz',
        sourceSha256:
            '6a33dc555cc9ba8b10caf7695878ef134eeb36d0af366041f639b1da9b6ed220',
        license: 'MIT',
    },
    libass: {
        version: '0.17.3',
        sourceUrl:
            'https://github.com/libass/libass/releases/download/0.17.3/libass-0.17.3.tar.xz',
        sourceSha256:
            'eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959',
        license: 'ISC',
    },
    openssl: {
        version: '3.5.7',
        sourceUrl:
            'https://github.com/openssl/openssl/releases/download/openssl-3.5.7/openssl-3.5.7.tar.gz',
        sourceSha256:
            'a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8',
        license: 'Apache-2.0',
    },
    ffmpeg: {
        version: '8.1',
        sourceUrl: 'https://ffmpeg.org/releases/ffmpeg-8.1.tar.xz',
        sourceSha256:
            'b072aed6871998cce9b36e7774033105ca29e33632be5b6347f3206898e0756a',
        license: 'LGPL-2.1-or-later',
    },
    libplacebo: {
        version: '7.360.1',
        sourceUrl: 'https://github.com/haasn/libplacebo.git',
        sourceTag: 'v7.360.1',
        sourceGitCommit: 'cee9b076f2c63104ccfd497fa79c39a867293ec4',
        license: 'LGPL-2.1-or-later',
    },
    hwdata: {
        version: '0.409',
        sourceUrl:
            'https://github.com/vcrhonek/hwdata/archive/refs/tags/v0.409.tar.gz',
        sourceSha256:
            '23006accc0f931dd5187d0307a57d0744e2b8feb85e73c37bc0f5229fb31eadd',
        buildInput: {
            consumer: 'libdisplay-info',
            relativePath: 'pnp.ids',
            purpose: 'PNP vendor lookup table compiled into libdisplay-info.',
        },
        license: 'GPL-2.0-or-later OR XFree86-1.0',
    },
    'libdisplay-info': {
        version: '0.1.1',
        sourceUrl:
            'https://gitlab.freedesktop.org/emersion/libdisplay-info/-/releases/0.1.1/downloads/libdisplay-info-0.1.1.tar.xz',
        sourceSha256:
            '0d8731588e9f82a9cac96324a3d7c82e2ba5b1b5e006143fefe692c74069fb60',
        license: 'MIT',
    },
    mpv: {
        version: '0.41.0',
        sourceUrl:
            'https://github.com/mpv-player/mpv/archive/refs/tags/v0.41.0.tar.gz',
        sourceSha256:
            'ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209',
        license: 'LGPL-2.1-or-later with -Dgpl=false',
    },
} as const;

const EXPECTED_ARTIFACTS = {
    addon: {
        name: FRAME_COPY_ADDON_NAME,
        regularFile: true,
        readable: true,
    },
    frameReader: {
        name: FRAME_COPY_READER_NAME,
        regularFile: true,
        readable: true,
    },
    helper: {
        name: FRAME_COPY_HELPER_NAME,
        regularFile: true,
        readable: true,
        executable: true,
    },
};

const EXPECTED_PROCESS_ISOLATION = {
    addonLoadsLibmpv: false,
    readerLoadsLibmpv: false,
    electronLoadsLibmpv: false,
    helperLinksLibmpv: true,
    helperRunpath: ['$ORIGIN/lib'],
};

const EXPECTED_DEVELOPMENT_ARTIFACTS = {
    addon: FRAME_COPY_ADDON_NAME,
    frameReader: FRAME_COPY_READER_NAME,
    helper: FRAME_COPY_HELPER_NAME,
};

const EXPECTED_DEVELOPMENT_PROCESS_ISOLATION = {
    addonLoadsLibmpv: false,
    helperLinksLibmpv: true,
    helperRunpath: ['$ORIGIN/lib'],
};

const DEVELOPMENT_MANIFEST_FIELDS = [
    'allowedPackageRuntimeModes',
    'arch',
    'artifacts',
    'buildInputMode',
    'generatedAt',
    'libmpvSoname',
    'nativeViewFallback',
    'origin',
    'packageRuntimeAvailability',
    'platform',
    'processIsolation',
    'runtimeFiles',
    'runtimeTotalBytes',
    'schemaVersion',
    'sourceRuntime',
    'sourceRuntimeValidated',
] as const;

const SYSTEM_PACKAGE_DEPENDENCIES = {
    deb: 'libmpv2',
    rpm: 'mpv-libs',
    pacman: 'mpv',
};

const PROFILE_CONTRACTS = {
    system: {
        origin: 'system-libmpv-frame-copy',
        runtimeMode: 'system',
        targets: new Set(['deb', 'rpm', 'pacman']),
    },
    portable: {
        origin: 'bundled-lgpl-frame-copy',
        runtimeMode: 'bundled',
        targets: new Set(['appimage', 'snap']),
    },
    flatpak: {
        origin: 'bundled-lgpl-frame-copy',
        runtimeMode: 'bundled',
        targets: new Set(['flatpak']),
    },
} as const;

const BASE_MANIFEST_FIELDS = [
    'arch',
    'artifacts',
    'generatedAt',
    'libmpvSoname',
    'nativeViewFallback',
    'origin',
    'packageDependencies',
    'platform',
    'processIsolation',
    'profile',
    'runtimeFiles',
    'runtimeMode',
    'runtimeTotalBytes',
    'schemaVersion',
    'targets',
] as const;

const BUNDLED_MANIFEST_FIELDS = [
    ...BASE_MANIFEST_FIELDS,
    'externalSystemLibraries',
    'runtimeDependencyClosure',
    'sourceRuntime',
] as const;

export type EmbeddedMpvFrameCopyRuntimeFailureReason =
    | 'unsupported-platform'
    | 'unsupported-architecture'
    | 'runtime-manifest-missing'
    | 'runtime-manifest-invalid'
    | 'runtime-artifact-missing'
    | 'runtime-artifact-invalid'
    | 'runtime-library-directory-invalid'
    | 'runtime-library-missing'
    | 'runtime-library-undeclared'
    | 'runtime-library-invalid'
    | 'runtime-library-size-mismatch'
    | 'runtime-library-hash-mismatch'
    | 'helper-probe-timeout'
    | 'helper-probe-spawn-error'
    | 'helper-probe-signaled'
    | 'helper-probe-failed'
    | 'helper-probe-invalid-output'
    | 'helper-probe-protocol-mismatch'
    | 'helper-probe-unusable'
    | 'runtime-probe-internal-error';

export type EmbeddedMpvFrameCopyManifestContract = 'packaged' | 'development';
export type EmbeddedMpvFrameCopyRuntimeMode = 'system' | 'bundled';

type RuntimeProfile = keyof typeof PROFILE_CONTRACTS;
type RuntimeProbeProfile = RuntimeProfile | 'development';

export type EmbeddedMpvFrameCopyRuntimeResult =
    | {
          usable: true;
          profile: RuntimeProbeProfile;
          runtimeMode: 'system' | 'bundled';
          libmpv: string;
          renderApi: 'egl';
      }
    | {
          usable: false;
          reason: EmbeddedMpvFrameCopyRuntimeFailureReason;
      };

export interface EmbeddedMpvFrameCopyRuntimeFileSystem {
    accessSync(filePath: string, mode: number): void;
    lstatSync(filePath: string): nodeFileSystem.Stats;
    readFileSync(filePath: string): Buffer;
    readdirSync(filePath: string): string[];
}

export interface EmbeddedMpvFrameCopyRuntimeDependencies {
    platform: NodeJS.Platform;
    arch: string;
    env: NodeJS.ProcessEnv;
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem;
    spawnSync: typeof nodeSpawnSync;
}

interface RuntimeFile {
    name: string;
    size: number;
    sha256: string;
}

interface ValidManifest {
    profile: RuntimeProbeProfile;
    runtimeMode: EmbeddedMpvFrameCopyRuntimeMode;
    runtimeFiles: RuntimeFile[];
}

interface ValidatedPackage {
    manifest: ValidManifest;
    helperPath: string;
    nativeDir: string;
}

interface ValidationSuccess<T> {
    value: T;
}

interface ValidationFailure {
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason;
}

type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function failure(
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason
): EmbeddedMpvFrameCopyRuntimeResult {
    return { usable: false, reason };
}

function validationFailure(
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason
): ValidationFailure {
    return { reason };
}

function isValidationFailure<T>(
    result: ValidationResult<T>
): result is ValidationFailure {
    return 'reason' in result;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(
    value: Record<string, unknown>,
    fields: readonly string[]
): boolean {
    return isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort());
}

function isSafeRuntimeName(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value !== '.' &&
        value !== '..' &&
        path.basename(value) === value &&
        !value.includes('/') &&
        !value.includes('\\') &&
        SAFE_RUNTIME_NAME_PATTERN.test(value) &&
        SHARED_LIBRARY_PATTERN.test(value)
    );
}

function isMissingFileError(error: unknown): boolean {
    return (
        isObject(error) &&
        typeof error.code === 'string' &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    );
}

function fileIdentity(filePath: string, stat: nodeFileSystem.Stats): string {
    return [
        path.resolve(filePath),
        stat.dev,
        stat.ino,
        stat.mode,
        stat.size,
        stat.mtimeMs,
        stat.ctimeMs,
    ].join(':');
}

function readManifest(
    manifestPath: string,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
): ValidationResult<Record<string, unknown>> {
    let contents: Buffer;
    try {
        contents = fileSystem.readFileSync(manifestPath);
    } catch {
        return validationFailure('runtime-manifest-invalid');
    }

    try {
        const parsed: unknown = JSON.parse(contents.toString('utf8'));
        return isObject(parsed)
            ? { value: parsed }
            : validationFailure('runtime-manifest-invalid');
    } catch {
        return validationFailure('runtime-manifest-invalid');
    }
}

function validateTargets(
    targets: unknown,
    allowedTargets: ReadonlySet<string>
): boolean {
    const expectedTargets = [...allowedTargets].sort();
    if (
        !Array.isArray(targets) ||
        targets.length !== expectedTargets.length ||
        targets.some(
            (target) =>
                typeof target !== 'string' ||
                target.trim() !== target ||
                target.toLowerCase() !== target ||
                !allowedTargets.has(target)
        )
    ) {
        return false;
    }
    return isDeepStrictEqual(targets, expectedTargets);
}

function validateRuntimeFiles(value: unknown): RuntimeFile[] | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    const runtimeFiles: RuntimeFile[] = [];
    const names = new Set<string>();
    for (const candidate of value) {
        if (
            !isObject(candidate) ||
            !hasExactFields(candidate, ['name', 'sha256', 'size']) ||
            !isSafeRuntimeName(candidate.name) ||
            !Number.isSafeInteger(candidate.size) ||
            (candidate.size as number) <= 0 ||
            typeof candidate.sha256 !== 'string' ||
            !SHA256_PATTERN.test(candidate.sha256) ||
            names.has(candidate.name)
        ) {
            return null;
        }
        names.add(candidate.name);
        runtimeFiles.push({
            name: candidate.name,
            size: candidate.size as number,
            sha256: candidate.sha256,
        });
    }
    return isDeepStrictEqual(
        runtimeFiles.map(({ name }) => name).sort(),
        runtimeFiles.map(({ name }) => name)
    )
        ? runtimeFiles
        : null;
}

function validateRuntimeClosure(
    value: unknown,
    runtimeFiles: RuntimeFile[],
    libmpvSoname: string,
    externalSystemLibraries: unknown
): boolean {
    if (
        !isDeepStrictEqual(
            externalSystemLibraries,
            EXPECTED_EXTERNAL_SYSTEM_LIBRARIES
        ) ||
        !isObject(value) ||
        !hasExactFields(value, ['entries', 'externalDependencies']) ||
        !Array.isArray(value.entries) ||
        !Array.isArray(value.externalDependencies) ||
        value.externalDependencies.some(
            (dependency) =>
                typeof dependency !== 'string' ||
                !SAFE_RUNTIME_NAME_PATTERN.test(dependency) ||
                !SHARED_LIBRARY_PATTERN.test(dependency)
        )
    ) {
        return false;
    }

    const runtimeNames = runtimeFiles.map(({ name }) => name);
    const runtimeNameSet = new Set(runtimeNames);
    const closureNames: string[] = [];
    const computedExternalDependencies = new Set<string>();
    for (const entry of value.entries) {
        if (
            !isObject(entry) ||
            !hasExactFields(entry, [
                'name',
                'needed',
                'rpath',
                'runpath',
                'soname',
            ]) ||
            !isSafeRuntimeName(entry.name) ||
            (entry.soname !== null && !isSafeRuntimeName(entry.soname)) ||
            !Array.isArray(entry.needed) ||
            entry.needed.some(
                (dependency) =>
                    typeof dependency !== 'string' ||
                    !SAFE_RUNTIME_NAME_PATTERN.test(dependency) ||
                    !SHARED_LIBRARY_PATTERN.test(dependency)
            ) ||
            !isDeepStrictEqual(entry.rpath, []) ||
            !isDeepStrictEqual(entry.runpath, ['$ORIGIN']) ||
            new Set(entry.needed).size !== entry.needed.length ||
            !isDeepStrictEqual([...entry.needed].sort(), entry.needed)
        ) {
            return false;
        }
        closureNames.push(entry.name);
        for (const dependency of entry.needed) {
            if (runtimeNameSet.has(dependency)) {
                continue;
            }
            if (!ALLOWED_EXTERNAL_LIBRARY_NAMES.has(dependency)) {
                return false;
            }
            computedExternalDependencies.add(dependency);
        }
    }

    const linkerAlias = value.entries.find(
        (entry) => isObject(entry) && entry.name === 'libmpv.so'
    );
    return (
        isDeepStrictEqual(closureNames, runtimeNames) &&
        new Set(closureNames).size === closureNames.length &&
        isDeepStrictEqual(
            value.externalDependencies,
            [...computedExternalDependencies].sort()
        ) &&
        isObject(linkerAlias) &&
        linkerAlias.soname === libmpvSoname
    );
}

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
        candidate.sourceGitCommit === expected.sourceGitCommit &&
        GIT_COMMIT_PATTERN.test(candidate.sourceGitCommit) &&
        candidate.sourceSha256 === undefined &&
        validatesGitSubmoduleRecords(candidate.sourceSubmodules)
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
function validateSourceRuntimePolicy(
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

function validatePackagedManifest(
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

function validateDevelopmentManifest(
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

function validateRegularArtifact(
    filePath: string,
    accessMode: number,
    expectedMode: number | null,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
): ValidationResult<nodeFileSystem.Stats> {
    let stat: nodeFileSystem.Stats;
    try {
        stat = fileSystem.lstatSync(filePath);
    } catch (error) {
        return validationFailure(
            isMissingFileError(error)
                ? 'runtime-artifact-missing'
                : 'runtime-artifact-invalid'
        );
    }

    if (
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        (expectedMode !== null && (stat.mode & 0o777) !== expectedMode)
    ) {
        return validationFailure('runtime-artifact-invalid');
    }
    try {
        fileSystem.accessSync(filePath, accessMode);
    } catch {
        return validationFailure('runtime-artifact-invalid');
    }
    return { value: stat };
}

function pathExistsByLstat(
    filePath: string,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
): boolean {
    try {
        fileSystem.lstatSync(filePath);
        return true;
    } catch (error) {
        if (isMissingFileError(error)) {
            return false;
        }
        throw error;
    }
}

function validateBundledRuntimeFiles(
    nativeDir: string,
    runtimeFiles: RuntimeFile[],
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem
): ValidationResult<true> {
    const libDir = path.join(nativeDir, 'lib');
    let libStat: nodeFileSystem.Stats;
    try {
        libStat = fileSystem.lstatSync(libDir);
    } catch {
        return validationFailure('runtime-library-directory-invalid');
    }
    if (libStat.isSymbolicLink() || !libStat.isDirectory()) {
        return validationFailure('runtime-library-directory-invalid');
    }

    let packagedNames: string[];
    try {
        packagedNames = fileSystem.readdirSync(libDir) as string[];
    } catch {
        return validationFailure('runtime-library-directory-invalid');
    }
    const declaredNames = new Set(runtimeFiles.map(({ name }) => name));
    if (packagedNames.some((name) => !declaredNames.has(name))) {
        return validationFailure('runtime-library-undeclared');
    }

    for (const runtimeFile of runtimeFiles) {
        const runtimePath = path.join(libDir, runtimeFile.name);
        let stat: nodeFileSystem.Stats;
        try {
            stat = fileSystem.lstatSync(runtimePath);
        } catch (error) {
            return validationFailure(
                isMissingFileError(error)
                    ? 'runtime-library-missing'
                    : 'runtime-library-invalid'
            );
        }
        if (stat.isSymbolicLink() || !stat.isFile()) {
            return validationFailure('runtime-library-invalid');
        }
        try {
            fileSystem.accessSync(runtimePath, nodeFileSystem.constants.R_OK);
        } catch {
            return validationFailure('runtime-library-invalid');
        }
        if (stat.size !== runtimeFile.size) {
            return validationFailure('runtime-library-size-mismatch');
        }

        let contents: Buffer;
        try {
            contents = fileSystem.readFileSync(runtimePath);
        } catch {
            return validationFailure('runtime-library-invalid');
        }
        if (contents.length !== runtimeFile.size) {
            return validationFailure('runtime-library-size-mismatch');
        }
        const actualSha256 = createHash('sha256')
            .update(contents)
            .digest('hex');
        if (actualSha256 !== runtimeFile.sha256) {
            return validationFailure('runtime-library-hash-mismatch');
        }
    }
    return { value: true };
}

function validatePackage(
    helperPath: string,
    manifestPath: string,
    fileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem,
    manifestContract: EmbeddedMpvFrameCopyManifestContract
): ValidationResult<ValidatedPackage> {
    const nativeDir = path.dirname(helperPath);
    if (
        path.basename(helperPath) !== FRAME_COPY_HELPER_NAME ||
        path.dirname(manifestPath) !== nativeDir
    ) {
        return validationFailure('runtime-artifact-invalid');
    }

    const manifestArtifact = validateRegularArtifact(
        manifestPath,
        nodeFileSystem.constants.R_OK,
        0o644,
        fileSystem
    );
    if (isValidationFailure(manifestArtifact)) {
        return validationFailure(
            manifestArtifact.reason === 'runtime-artifact-missing'
                ? 'runtime-manifest-missing'
                : 'runtime-manifest-invalid'
        );
    }
    const manifestResult = readManifest(manifestPath, fileSystem);
    if (isValidationFailure(manifestResult)) {
        return manifestResult;
    }
    const validManifest =
        manifestContract === 'packaged'
            ? validatePackagedManifest(manifestResult.value)
            : validateDevelopmentManifest(manifestResult.value);
    if (isValidationFailure(validManifest)) {
        return validManifest;
    }

    for (const [artifactPath, accessMode, expectedMode] of [
        [
            path.join(nativeDir, FRAME_COPY_ADDON_NAME),
            nodeFileSystem.constants.R_OK,
            null,
        ],
        [
            path.join(nativeDir, FRAME_COPY_READER_NAME),
            nodeFileSystem.constants.R_OK,
            0o644,
        ],
        [
            helperPath,
            nodeFileSystem.constants.R_OK | nodeFileSystem.constants.X_OK,
            0o755,
        ],
    ] as const) {
        const artifact = validateRegularArtifact(
            artifactPath,
            accessMode,
            expectedMode,
            fileSystem
        );
        if (isValidationFailure(artifact)) {
            return artifact;
        }
    }

    const libDir = path.join(nativeDir, 'lib');
    if (validManifest.value.runtimeMode === 'system') {
        try {
            if (pathExistsByLstat(libDir, fileSystem)) {
                return validationFailure('runtime-library-directory-invalid');
            }
        } catch {
            return validationFailure('runtime-library-directory-invalid');
        }
    } else {
        const bundledRuntime = validateBundledRuntimeFiles(
            nativeDir,
            validManifest.value.runtimeFiles,
            fileSystem
        );
        if (isValidationFailure(bundledRuntime)) {
            return bundledRuntime;
        }
    }

    return {
        value: {
            manifest: validManifest.value,
            helperPath,
            nativeDir,
        },
    };
}

function parseSuccessfulProbe(
    stdout: unknown,
    manifest: ValidManifest
): EmbeddedMpvFrameCopyRuntimeResult {
    if (typeof stdout !== 'string' || !/^[^\r\n]+\n$/.test(stdout)) {
        return failure('helper-probe-invalid-output');
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout.slice(0, -1));
    } catch {
        return failure('helper-probe-invalid-output');
    }
    if (!isObject(parsed)) {
        return failure('helper-probe-invalid-output');
    }
    if (parsed.protocol !== RUNTIME_PROBE_PROTOCOL) {
        return failure('helper-probe-protocol-mismatch');
    }
    if (parsed.usable !== true) {
        return failure(
            parsed.usable === false
                ? 'helper-probe-unusable'
                : 'helper-probe-invalid-output'
        );
    }
    if (
        !hasExactFields(parsed, [
            'libmpv',
            'protocol',
            'renderApi',
            'usable',
        ]) ||
        typeof parsed.libmpv !== 'string' ||
        parsed.libmpv.trim() === '' ||
        parsed.renderApi !== 'egl'
    ) {
        return failure('helper-probe-invalid-output');
    }
    return {
        usable: true,
        profile: manifest.profile,
        runtimeMode: manifest.runtimeMode,
        libmpv: parsed.libmpv,
        renderApi: parsed.renderApi,
    };
}

const TRUSTED_SNAP_MOUNT_ROOTS = ['/snap', '/var/lib/snapd/snap'] as const;
const TRUSTED_SNAP_GL_ROOT = '/var/lib/snapd/lib/gl';

function isPathInside(
    parentPath: string,
    candidatePath: string,
    allowEqual: boolean
): boolean {
    const relativePath = path.relative(parentPath, candidatePath);
    if (relativePath === '') {
        return allowEqual;
    }
    return (
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

function resolveTrustedSnapRoot(
    environment: NodeJS.ProcessEnv,
    nativeDir: string
): string | null {
    const declaredSnapRoot = environment.SNAP;
    if (
        !declaredSnapRoot ||
        !path.isAbsolute(declaredSnapRoot) ||
        !path.isAbsolute(nativeDir)
    ) {
        return null;
    }

    const normalizedSnapRoot = path.resolve(declaredSnapRoot);
    const resemblesReadOnlySnapMount = TRUSTED_SNAP_MOUNT_ROOTS.some(
        (mountRoot) => {
            const relativePath = path.relative(mountRoot, normalizedSnapRoot);
            return (
                isPathInside(mountRoot, normalizedSnapRoot, false) &&
                relativePath.split(path.sep).filter(Boolean).length >= 2
            );
        }
    );
    if (
        !resemblesReadOnlySnapMount ||
        !isPathInside(normalizedSnapRoot, path.resolve(nativeDir), false)
    ) {
        return null;
    }
    return normalizedSnapRoot;
}

function getTrustedSnapLibraryPaths(
    environment: NodeJS.ProcessEnv,
    snapRoot: string
): string[] {
    const snapLibraryPaths = (environment.SNAP_LIBRARY_PATH ?? '')
        .split(':')
        .filter(Boolean)
        .filter((libraryPath) => path.isAbsolute(libraryPath))
        .map((libraryPath) => path.resolve(libraryPath))
        .filter((libraryPath) =>
            isPathInside(TRUSTED_SNAP_GL_ROOT, libraryPath, true)
        );

    return [
        ...snapLibraryPaths,
        path.join(snapRoot, 'lib'),
        path.join(snapRoot, 'usr', 'lib'),
        path.join(snapRoot, 'lib', 'x86_64-linux-gnu'),
        path.join(snapRoot, 'usr', 'lib', 'x86_64-linux-gnu'),
    ];
}

/**
 * Builds the loader environment shared by the bounded startup probe and each
 * real Linux helper session. The validated package profile is authoritative:
 * system packages use the system loader, while bundled packages start at
 * native/lib and may add only immutable-looking Snap runtime/GL roots.
 */
export function createLinuxFrameCopyHelperEnvironment(
    environment: NodeJS.ProcessEnv,
    nativeDir: string,
    runtimeMode: EmbeddedMpvFrameCopyRuntimeMode
): NodeJS.ProcessEnv {
    const helperEnvironment = { ...environment };
    delete helperEnvironment.LD_LIBRARY_PATH;
    delete helperEnvironment.LD_PRELOAD;

    if (runtimeMode === 'system') {
        return helperEnvironment;
    }

    const libraryPaths = [path.join(nativeDir, 'lib')];
    const trustedSnapRoot = resolveTrustedSnapRoot(environment, nativeDir);
    if (trustedSnapRoot) {
        libraryPaths.push(
            ...getTrustedSnapLibraryPaths(environment, trustedSnapRoot)
        );
    }
    helperEnvironment.LD_LIBRARY_PATH = [...new Set(libraryPaths)].join(':');
    return helperEnvironment;
}

function runHelperProbe(
    runtimePackage: ValidatedPackage,
    dependencies: EmbeddedMpvFrameCopyRuntimeDependencies
): EmbeddedMpvFrameCopyRuntimeResult {
    const probeEnvironment = createLinuxFrameCopyHelperEnvironment(
        dependencies.env,
        runtimePackage.nativeDir,
        runtimePackage.manifest.runtimeMode
    );

    let result: ReturnType<typeof nodeSpawnSync>;
    try {
        result = dependencies.spawnSync(
            runtimePackage.helperPath,
            ['--runtime-probe'],
            {
                encoding: 'utf8',
                timeout: RUNTIME_PROBE_TIMEOUT_MS,
                killSignal: 'SIGKILL',
                windowsHide: true,
                env: probeEnvironment,
            }
        );
    } catch {
        return failure('helper-probe-spawn-error');
    }

    if (
        result.error &&
        'code' in result.error &&
        result.error.code === 'ETIMEDOUT'
    ) {
        return failure('helper-probe-timeout');
    }
    if (result.error) {
        return failure('helper-probe-spawn-error');
    }
    if (result.signal) {
        return failure('helper-probe-signaled');
    }
    if (result.status !== 0) {
        return failure('helper-probe-failed');
    }
    return parseSuccessfulProbe(result.stdout, runtimePackage.manifest);
}

/**
 * Creates an isolated probe/cache. Production uses the singleton below;
 * tests inject filesystem and spawn collaborators through this factory.
 */
export function createEmbeddedMpvFrameCopyRuntimeProbe(
    overrides: Partial<EmbeddedMpvFrameCopyRuntimeDependencies> = {}
): (
    helperPath: string,
    manifestContract?: EmbeddedMpvFrameCopyManifestContract
) => EmbeddedMpvFrameCopyRuntimeResult {
    const defaultFileSystem: EmbeddedMpvFrameCopyRuntimeFileSystem = {
        accessSync: (filePath, mode) =>
            nodeFileSystem.accessSync(filePath, mode),
        lstatSync: (filePath) => nodeFileSystem.lstatSync(filePath),
        readFileSync: (filePath) => nodeFileSystem.readFileSync(filePath),
        readdirSync: (filePath) => nodeFileSystem.readdirSync(filePath),
    };
    const dependencies: EmbeddedMpvFrameCopyRuntimeDependencies = {
        platform: process.platform,
        arch: process.arch,
        env: process.env,
        fileSystem: defaultFileSystem,
        spawnSync: nodeSpawnSync,
        ...overrides,
    };
    const resultCache = new Map<string, EmbeddedMpvFrameCopyRuntimeResult>();

    return (
        helperPath: string,
        manifestContract: EmbeddedMpvFrameCopyManifestContract = 'packaged'
    ): EmbeddedMpvFrameCopyRuntimeResult => {
        if (dependencies.platform !== 'linux') {
            return failure('unsupported-platform');
        }
        if (dependencies.arch !== 'x64') {
            return failure('unsupported-architecture');
        }

        const manifestPath = path.join(
            path.dirname(helperPath),
            RUNTIME_MANIFEST_NAME
        );
        let helperStat: nodeFileSystem.Stats;
        let manifestStat: nodeFileSystem.Stats;
        try {
            helperStat = dependencies.fileSystem.lstatSync(helperPath);
        } catch {
            return failure('runtime-artifact-missing');
        }
        try {
            manifestStat = dependencies.fileSystem.lstatSync(manifestPath);
        } catch (error) {
            return failure(
                isMissingFileError(error)
                    ? 'runtime-manifest-missing'
                    : 'runtime-manifest-invalid'
            );
        }

        const cacheKey = `${manifestContract}\0${fileIdentity(
            helperPath,
            helperStat
        )}\0${fileIdentity(manifestPath, manifestStat)}`;
        const cached = resultCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        let result: EmbeddedMpvFrameCopyRuntimeResult;
        try {
            const runtimePackage = validatePackage(
                helperPath,
                manifestPath,
                dependencies.fileSystem,
                manifestContract
            );
            result = isValidationFailure(runtimePackage)
                ? failure(runtimePackage.reason)
                : runHelperProbe(runtimePackage.value, dependencies);
        } catch {
            result = failure('runtime-probe-internal-error');
        }
        resultCache.set(cacheKey, result);
        return result;
    };
}

const processRuntimeProbe = createEmbeddedMpvFrameCopyRuntimeProbe();

/**
 * Fail-closed, process-lifetime Linux runtime decision shared by startup and
 * the service gate. The helper and manifest identities scope cached results.
 */
export function probeEmbeddedMpvFrameCopyRuntime(
    helperPath: string,
    manifestContract: EmbeddedMpvFrameCopyManifestContract
): EmbeddedMpvFrameCopyRuntimeResult {
    return processRuntimeProbe(helperPath, manifestContract);
}
