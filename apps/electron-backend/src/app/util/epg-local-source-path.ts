import { isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';
import { classifyEpgSourceReference } from '@iptvnator/shared/interfaces';

/**
 * The filesystem path behind an EPG source reference, or null when the
 * reference is not a local file (a remote link, an empty value or a relative
 * path). Shared by the main-process authorizer and the worker so both agree
 * on which string names which file: a `file:` URL and the plain path it
 * encodes normalize to the same value.
 */
export function resolveLocalEpgSourcePath(reference: string): string | null {
    const trimmed = reference.trim();
    if (classifyEpgSourceReference(trimmed) !== 'local') {
        return null;
    }
    if (/^file:/i.test(trimmed)) {
        try {
            return resolve(fileURLToPath(trimmed));
        } catch {
            return null;
        }
    }
    return isAbsolute(trimmed) ? resolve(trimmed) : null;
}
