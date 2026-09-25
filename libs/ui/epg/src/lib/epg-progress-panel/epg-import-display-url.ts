const MAX_PLAIN_LENGTH = 40;

/**
 * Compact single-line label for an EPG source: the host, an ellipsis for
 * any intermediate path, and the file name — `host/…/file.xml.gz`. A local
 * file (a `file:` URL or a filesystem path) shows `…/file.xml.gz`, since the
 * host slot would be empty. Query strings and credentials are never
 * rendered; the full value belongs in the tooltip only.
 */
export function formatEpgImportDisplayUrl(url: string): string {
    let parsed: URL | null = null;
    try {
        parsed = new URL(url);
    } catch {
        parsed = null;
    }

    if (parsed && parsed.protocol !== 'file:' && parsed.hostname) {
        const segments = parsed.pathname.split('/').filter(Boolean);
        const file = segments[segments.length - 1];
        if (!file) {
            return parsed.hostname;
        }
        const name = safeDecode(file);
        return segments.length > 1
            ? `${parsed.hostname}/…/${name}`
            : `${parsed.hostname}/${name}`;
    }

    const localPath = parsed?.protocol === 'file:' ? parsed.pathname : url;
    const segments = localPath.split(/[\\/]/).filter(Boolean);
    const file = segments[segments.length - 1];
    if (file && segments.length > 1) {
        return `…/${safeDecode(file)}`;
    }

    return url.length > MAX_PLAIN_LENGTH
        ? `${url.substring(0, MAX_PLAIN_LENGTH)}…`
        : url;
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
