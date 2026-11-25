import { isRemoteEpgSourceUrl } from '@iptvnator/shared/interfaces';

/** Backup matching keeps local path spelling, including case and separators. */
export function epgSourceReferenceIdentity(value: string): string {
    const reference = value.trim();
    if (!isRemoteEpgSourceUrl(reference)) return reference;
    try {
        return new URL(reference).href;
    } catch {
        return reference;
    }
}

export function mergeBackupEpgUrls(
    primary: string[],
    secondary: string[]
): string[] {
    const merged = new Map<string, string>();
    for (const url of [...primary, ...secondary]) {
        const identity = epgSourceReferenceIdentity(url);
        if (identity && !merged.has(identity)) merged.set(identity, url.trim());
    }
    return [...merged.values()];
}
