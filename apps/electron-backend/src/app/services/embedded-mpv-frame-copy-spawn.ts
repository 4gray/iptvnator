import { EmbeddedMpvBounds } from '@iptvnator/shared/interfaces';
import { createLinuxFrameCopyHelperLaunch } from './embedded-mpv-frame-copy-runtime';
import type {
    EmbeddedMpvFrameCopyRuntimeMode,
    LinuxFrameCopyHelperLaunchFileSystem,
} from './embedded-mpv-frame-copy-runtime';

/**
 * Resolves how a frame-copy helper process is launched: the offscreen render
 * size in device pixels, and — on Linux — the sanitized loader environment and
 * graphics-provider wrapper the validated runtime requires.
 */

export interface FrameCopyHelperSpawnRequest {
    bounds: EmbeddedMpvBounds;
    environment?: NodeJS.ProcessEnv;
    helperLaunchFileSystem?: LinuxFrameCopyHelperLaunchFileSystem;
    helperPath: string;
    initialVolume?: number;
    resolveRuntimeMode: () => EmbeddedMpvFrameCopyRuntimeMode | null;
    scale: number;
    sessionId: string;
}

export interface FrameCopyHelperSpawnPlan {
    args: string[];
    command: string;
    env?: NodeJS.ProcessEnv;
    height: number;
    width: number;
}

export function resolveFrameCopyHelperSpawn(
    request: FrameCopyHelperSpawnRequest
): FrameCopyHelperSpawnPlan {
    const {
        bounds,
        environment,
        helperLaunchFileSystem,
        helperPath,
        initialVolume,
        resolveRuntimeMode,
        scale,
        sessionId,
    } = request;

    const width = Math.max(16, Math.round(bounds.width * scale));
    const height = Math.max(16, Math.round(bounds.height * scale));
    const helperArgs = [
        '--shm-base',
        `/${sessionId}`,
        '--width',
        String(width),
        '--height',
        String(height),
        '--volume',
        String(Math.min(Math.max(initialVolume ?? 1, 0), 1)),
        // Lip-sync compensation for the video path's added latency
        // (~10 ms measured on M1 Pro); tunable until calibration
        // lands, see the architecture doc.
        ...(process.env.IPTVNATOR_EMBEDDED_MPV_AUDIO_DELAY
            ? ['--audio-delay', process.env.IPTVNATOR_EMBEDDED_MPV_AUDIO_DELAY]
            : []),
        // Session options follow as the first stdin line (see
        // buildMpvOptionsPreamble), never as arguments `ps` could read.
        '--mpv-options-stdin',
    ];

    if (process.platform !== 'linux') {
        return { args: helperArgs, command: helperPath, height, width };
    }

    const runtimeMode = resolveRuntimeMode();
    if (!runtimeMode) {
        throw new Error(
            'A validated Linux frame-copy runtime is not available.'
        );
    }
    const launch = createLinuxFrameCopyHelperLaunch({
        environment: environment ?? process.env,
        helperPath,
        helperArgs,
        runtimeMode,
        fileSystem: helperLaunchFileSystem,
    });
    if (!launch.usable) {
        throw new Error(
            'The connected Snap graphics provider is not available.'
        );
    }

    return {
        args: launch.args,
        command: launch.command,
        env: launch.env,
        height,
        width,
    };
}
