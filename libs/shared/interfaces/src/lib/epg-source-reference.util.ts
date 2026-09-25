/**
 * Classification of the value a user types as an EPG source.
 *
 * A source is either a remote XMLTV link (`http:`/`https:`) or a local file:
 * a `file:` URL, an absolute POSIX path, a Windows drive path or a UNC path.
 * Relative paths are refused on purpose — the main process has no meaningful
 * working directory to resolve them against.
 *
 * Only values the user entered by hand (Settings → EPG, the playlist dialog)
 * may be local. URLs harvested from an M3U header are filtered to remote ones
 * before they are stored, so a downloaded playlist can never point the EPG
 * importer at a file on the user's disk.
 */
export type EpgSourceReferenceKind = 'remote' | 'local';

export const EPG_SOURCE_REFERENCE_ERROR = 'epgSourceReference';

const REMOTE_EPG_SOURCE_PATTERN = /^https?:\/\/[^\s"]+$/i;
const FILE_URL_EPG_SOURCE_PATTERN = /^file:\/\/[^\s"]+$/i;
const POSIX_ABSOLUTE_PATH_PATTERN = /^\/[^\0]+$/;
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-z]:[\\/][^\0]*$/i;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\/\0]+\\[^\\/\0]+/;

export function classifyEpgSourceReference(
    value: string | null | undefined
): EpgSourceReferenceKind | null {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '') {
        return null;
    }
    if (REMOTE_EPG_SOURCE_PATTERN.test(trimmed)) {
        return 'remote';
    }
    if (
        FILE_URL_EPG_SOURCE_PATTERN.test(trimmed) ||
        POSIX_ABSOLUTE_PATH_PATTERN.test(trimmed) ||
        WINDOWS_DRIVE_PATH_PATTERN.test(trimmed) ||
        WINDOWS_UNC_PATH_PATTERN.test(trimmed)
    ) {
        return 'local';
    }
    return null;
}

export function isRemoteEpgSourceUrl(
    value: string | null | undefined
): boolean {
    return classifyEpgSourceReference(value) === 'remote';
}

export function isLocalEpgSourceReference(
    value: string | null | undefined
): boolean {
    return classifyEpgSourceReference(value) === 'local';
}

/**
 * Form validator shared by the Settings EPG list and the playlist dialog.
 * Typed structurally so this contracts library stays Angular-free; an empty
 * control is valid, mirroring `Validators.pattern`.
 */
export function validateEpgSourceReferenceControl(control: {
    value: unknown;
}): Record<typeof EPG_SOURCE_REFERENCE_ERROR, true> | null {
    const value = control.value;
    if (typeof value !== 'string' || value.trim() === '') {
        return null;
    }
    return classifyEpgSourceReference(value)
        ? null
        : { [EPG_SOURCE_REFERENCE_ERROR]: true };
}
