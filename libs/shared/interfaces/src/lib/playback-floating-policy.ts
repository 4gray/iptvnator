import type { EmbeddedMpvEngine } from './embedded-mpv-session.interface';

/** Native window reparenting is a distinct capability from browser PiP. */
export function supportsNativeFloatingPlayer(
    platform: string | undefined,
    engine: EmbeddedMpvEngine | undefined,
    canReparent: boolean
): boolean {
    return platform === 'win32' && engine === 'native' && canReparent;
}
