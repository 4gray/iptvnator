import { normalizeXtreamServerUrl } from '@iptvnator/shared/interfaces';
import type { XtreamCredentials } from './xtream-api.service';

/**
 * One account: the panel and the user on it. Stream ids are provider-local
 * (panels number them from 1), so the EPG queue's per-stream memory is only
 * meaningful for the account that filled it.
 */
export function ownerKeyOf(credentials: XtreamCredentials): string {
    let server = credentials.serverUrl.trim();
    try {
        server = normalizeXtreamServerUrl(server);
    } catch {
        // An unparsable URL still identifies its account as written.
    }
    return `${server}\u0000${credentials.username.trim()}`;
}
