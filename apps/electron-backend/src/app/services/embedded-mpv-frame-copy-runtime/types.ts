import type { spawnSync as nodeSpawnSync } from 'child_process';
import type * as nodeFileSystem from 'fs';

export const EMBEDDED_MPV_HELPER_RUNTIME_PROBE_FAILURE_REASONS = {
    MPV_CREATE_FAILED: 'mpv-create-failed',
    MPV_INITIALIZE_FAILED: 'mpv-initialize-failed',
    GL_CONTEXT_CREATE_FAILED: 'gl-context-create-failed',
    GL_CONTEXT_BIND_FAILED: 'gl-context-bind-failed',
    MPV_RENDER_CONTEXT_FAILED: 'mpv-render-context-failed',
    SHARED_MEMORY_CREATE_FAILED: 'shared-memory-create-failed',
    SHARED_MEMORY_INITIALIZE_FAILED: 'shared-memory-initialize-failed',
} as const;

export type EmbeddedMpvHelperRuntimeProbeFailureReason =
    (typeof EMBEDDED_MPV_HELPER_RUNTIME_PROBE_FAILURE_REASONS)[keyof typeof EMBEDDED_MPV_HELPER_RUNTIME_PROBE_FAILURE_REASONS];

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
    | 'snap-graphics-provider-unavailable'
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

export type RuntimeProfile = 'system' | 'portable' | 'flatpak';
export type RuntimeProbeProfile = RuntimeProfile | 'development';

export type EmbeddedMpvFrameCopyRuntimeResult =
    | {
          usable: true;
          profile: RuntimeProbeProfile;
          runtimeMode: EmbeddedMpvFrameCopyRuntimeMode;
          libmpv: string;
          renderApi: 'egl';
      }
    | {
          usable: false;
          reason: EmbeddedMpvFrameCopyRuntimeFailureReason;
          helperReason?: EmbeddedMpvHelperRuntimeProbeFailureReason;
          helperDetail?: string;
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
    writeStderr(output: string): void;
}

export interface RuntimeFile {
    name: string;
    size: number;
    sha256: string;
}

export interface ValidManifest {
    profile: RuntimeProbeProfile;
    runtimeMode: EmbeddedMpvFrameCopyRuntimeMode;
    runtimeFiles: RuntimeFile[];
}

export interface ValidatedPackage {
    manifest: ValidManifest;
    helperPath: string;
    nativeDir: string;
}

export interface ValidationSuccess<T> {
    value: T;
}

export interface ValidationFailure {
    reason: EmbeddedMpvFrameCopyRuntimeFailureReason;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;
