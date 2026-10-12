export interface ServerStorageConfig {
    /** `IPTVNATOR_STORAGE=server`; the Docker image sets it. */
    readonly enabled: boolean;
    /** `IPTVNATOR_ACCESS_TOKEN`; guards every non-public route when set. */
    readonly accessToken: string | null;
    /** Largest accepted playlist document (`IPTVNATOR_MAX_DOCUMENT_MB`). */
    readonly maxDocumentBytes: number;
}

const DEFAULT_MAX_DOCUMENT_MB = 64;
const BYTES_PER_MB = 1024 * 1024;

export function readServerStorageConfig(
    env: Record<string, string | undefined> = process.env
): ServerStorageConfig {
    const mode = env['IPTVNATOR_STORAGE']?.trim().toLowerCase();
    const token = env['IPTVNATOR_ACCESS_TOKEN']?.trim();
    const megabytes = Number(env['IPTVNATOR_MAX_DOCUMENT_MB']);

    return {
        enabled: mode === 'server',
        accessToken: token ? token : null,
        maxDocumentBytes:
            (Number.isFinite(megabytes) && megabytes > 0
                ? megabytes
                : DEFAULT_MAX_DOCUMENT_MB) * BYTES_PER_MB,
    };
}
