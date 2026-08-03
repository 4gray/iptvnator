/**
 * Pure `cmd` handling shared by every Stalker playback path.
 *
 * Kept apart from the request helpers so the link-semantics decision (which
 * needs the normalizer) and the request helpers (which need the decision) do
 * not import each other.
 */

export function normalizeStalkerPlaybackCommand(value: string): string {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
        return '';
    }

    const splitAt = trimmed.indexOf(' ');
    if (splitAt > 0) {
        const candidate = trimmed.slice(splitAt + 1).trim();
        if (
            candidate.startsWith('http://') ||
            candidate.startsWith('https://') ||
            candidate.startsWith('/') ||
            candidate.startsWith('?')
        ) {
            return candidate;
        }
    }

    return trimmed;
}

export function resolveStalkerPlaybackUrl(
    portalUrl: string,
    originalCmd: string,
    responseCmd: string
): string {
    const url = normalizeStalkerPlaybackCommand(responseCmd);
    if (!url) {
        return '';
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }

    try {
        const portalUrlObj = new URL(portalUrl);
        // The installation base is the endpoint path MINUS the API suffix
        // discovery appended (`/portal.php`, `/server/load.php`) — endpoint
        // discovery can persist arbitrary nested installations
        // (`/cp/server/load.php`), so a fixed segment allowlist would
        // resolve `/media/...` against the wrong root. The legacy marker
        // segments stay as the fallback for URLs that carry neither suffix.
        const endpointPath = portalUrlObj.pathname;
        let basePath = '';
        const apiSuffix = /\/(?:portal\.php|server\/load\.php|[^/]*\.php)$/i;
        if (apiSuffix.test(endpointPath)) {
            basePath = endpointPath.replace(apiSuffix, '');
        } else {
            const pathParts = endpointPath.split('/');
            for (let index = 0; index < pathParts.length; index += 1) {
                if (
                    pathParts[index] === 'stalker_portal' ||
                    pathParts[index] === 'c' ||
                    pathParts[index] === 'portal'
                ) {
                    basePath = '/' + pathParts.slice(1, index + 1).join('/');
                    break;
                }
            }
        }

        if (url.startsWith('?')) {
            const normalizedCmd = normalizeStalkerPlaybackCommand(originalCmd);
            if (
                normalizedCmd.startsWith('http://') ||
                normalizedCmd.startsWith('https://')
            ) {
                return `${normalizedCmd}${url}`;
            }

            return `${portalUrlObj.origin}${basePath}${normalizedCmd}${url}`;
        }

        if (url.startsWith('/')) {
            return `${portalUrlObj.origin}${basePath}${url}`;
        }
    } catch {
        return url;
    }

    return url;
}

export function shouldResolveMovieFileId(
    item: { has_files?: unknown } | null | undefined,
    cmd: string
): boolean {
    return (
        item?.has_files !== undefined &&
        !cmd.includes('://') &&
        cmd.includes('/media/') &&
        !cmd.includes('/media/file_')
    );
}
