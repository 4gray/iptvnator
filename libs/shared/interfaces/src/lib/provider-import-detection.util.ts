import {
    DetectedUrl,
    extractLabeledFields,
    extractMacAddresses,
    extractUrls,
    LabeledFields,
    labeledHostUrl,
} from './provider-import-scan.util';
import {
    extractXtreamCredentialsFromUrl,
    normalizeXtreamServerUrl,
} from './xtream-portal.utils';

/**
 * Deterministic detection of playlist sources inside a pasted provider
 * message ("here are your credentials" mails, reseller chat messages, etc.).
 *
 * Design constraints, in order:
 *
 * 1. **Every value is a verbatim substring of the NFKC-normalized input**
 *    (or a canonical form produced by an existing shared normalizer such as
 *    `normalizeStalkerMacAddress`). Nothing here invents, completes, or
 *    "fixes" a credential — a password that is almost right is wrong. NFKC
 *    is applied once up front because reseller messages dress labels in
 *    Unicode math alphabets (`𝚄𝚂𝙴𝚁➤`, `𝙿𝙰𝚂𝚂➤`) to slip past chat spam
 *    filters; the folding turns them back into the ASCII they denote, and
 *    real credentials/URLs are ASCII already, so values pass through it
 *    unchanged.
 * 2. **Detection proposes, it never decides.** The output prefills the
 *    existing import forms; classification authority stays with the
 *    behavioral probes those forms already run (portal discovery, Xtream
 *    status check). URL-shape guessing shipped broken Stalker configs three
 *    times (#850/#686/#755) — this util must not become a fourth copy.
 * 3. Heuristics are ranked by strength: a MAC address is the strongest
 *    signal (→ Stalker), a `get.php`/`player_api.php` URL is next
 *    (→ Xtream, credentials ride in the query), a labeled
 *    username+password pair without a MAC leans Xtream, and `.m3u`
 *    extensions mean a plain playlist URL.
 *
 * The low-level scanners live in `provider-import-scan.util.ts`.
 */
export type ProviderImportKind = 'xtream' | 'stalker' | 'm3u-url' | 'm3u-text';

export type ProviderImportConfidence = 'high' | 'medium' | 'low';

export interface ProviderImportCandidate {
    kind: ProviderImportKind;
    confidence: ProviderImportConfidence;
    /** Suggested playlist title — the hostname of the detected source. */
    suggestedTitle?: string;
    /** `m3u-url`: the playlist link exactly as found in the text. */
    url?: string;
    /** `m3u-text`: the pasted playlist body itself. */
    text?: string;
    /** `xtream`: server base URL (API suffix stripped). */
    serverUrl?: string;
    username?: string;
    password?: string;
    /** `stalker` */
    portalUrl?: string;
    macAddress?: string;
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
}

const GET_PHP_PATH_PATTERN = /\/get\.php$/i;
const EXTM3U_HEADER_PATTERN = /^\s*#EXTM3U/i;
const MAX_CANDIDATES = 6;

/**
 * Scans a pasted provider message and returns ranked import candidates.
 * Pure and synchronous — safe to run on every keystroke.
 */
export function detectProviderImportCandidates(
    text: string
): ProviderImportCandidate[] {
    const raw = typeof text === 'string' ? text : '';
    if (!raw.trim()) {
        return [];
    }

    // A raw playlist body pasted wholesale: every URL inside is a channel
    // stream, not a source, so URL mining would only produce noise. Route the
    // whole paste to the raw-text import instead — the ORIGINAL bytes, since
    // a playlist body is content, not decoration to be folded.
    if (EXTM3U_HEADER_PATTERN.test(raw)) {
        return [{ kind: 'm3u-text', confidence: 'high', text: raw }];
    }

    // All scanning runs on one consistently normalized string so label
    // positions, URL spans and masking agree with each other.
    const normalized = raw.normalize('NFKC');
    const urls = extractUrls(normalized);
    const labeled = extractLabeledFields(normalized, urls);
    const macs = extractMacAddresses(normalized, labeled.macAddress);
    const candidates: ProviderImportCandidate[] = [];

    // ── Stalker: a MAC address is the strongest signal there is. Labeled
    // credentials attach here (Stalker portals can require a login too)
    // rather than seeding a competing Xtream guess.
    const portal = pickStalkerPortalUrl(urls, labeled);
    for (const macAddress of macs) {
        candidates.push(
            compact({
                kind: 'stalker',
                confidence: portal?.confidence ?? 'low',
                portalUrl: portal?.url,
                macAddress,
                serialNumber: labeled.serialNumber,
                deviceId1: labeled.deviceId1,
                deviceId2: labeled.deviceId2,
                signature1: labeled.signature1,
                signature2: labeled.signature2,
                username: labeled.username,
                password: labeled.password,
                suggestedTitle: hostnameOf(portal?.url),
            })
        );
    }

    // ── Xtream from URLs: an API-shaped path, or credentials in the query of
    // any non-playlist URL. A `.m3u` link with query credentials stays an M3U
    // candidate — its path would corrupt the derived server URL.
    for (const url of urls) {
        if (url.role === 'm3u' || url.role === 'stalker') {
            continue;
        }
        const creds = extractXtreamCredentialsFromUrl(url.raw);
        if (url.role !== 'xtream-api' && !creds) {
            continue;
        }
        const username =
            creds?.username ??
            (macs.length === 0 ? labeled.username : undefined);
        const password =
            creds?.password ??
            (macs.length === 0 ? labeled.password : undefined);
        candidates.push(
            compact({
                kind: 'xtream',
                confidence: username && password ? 'high' : 'medium',
                serverUrl: safeXtreamServerUrl(url.raw),
                username,
                password,
                suggestedTitle: url.parsed.hostname,
            })
        );
        // `get.php` doubles as the M3U download endpoint, so the same link is
        // honestly offered as a plain playlist too — ranked low because the
        // Xtream import unlocks VOD/series where the flat M3U does not.
        if (creds && GET_PHP_PATH_PATTERN.test(url.parsed.pathname)) {
            candidates.push({
                kind: 'm3u-url',
                confidence: 'low',
                url: url.raw,
                suggestedTitle: url.parsed.hostname,
            });
        }
    }

    // ── Xtream from labeled credentials alone (username + password with no
    // MAC in sight leans Xtream), attached to the best available server URL.
    if (
        macs.length === 0 &&
        labeled.username &&
        labeled.password &&
        !candidates.some((candidate) => candidate.kind === 'xtream')
    ) {
        const serverUrl =
            labeledHostUrl(labeled) ??
            urls.find((url) => url.role === 'generic')?.raw;
        candidates.push(
            compact({
                kind: 'xtream',
                confidence: serverUrl ? 'medium' : 'low',
                serverUrl: serverUrl
                    ? safeXtreamServerUrl(serverUrl)
                    : undefined,
                username: labeled.username,
                password: labeled.password,
                suggestedTitle: hostnameOf(serverUrl),
            })
        );
    }

    // ── Plain playlist links.
    for (const url of urls) {
        if (url.role !== 'm3u') {
            continue;
        }
        candidates.push({
            kind: 'm3u-url',
            confidence: 'high',
            url: url.raw,
            suggestedTitle: url.parsed.hostname,
        });
    }

    return sortByConfidence(dedupe(candidates)).slice(0, MAX_CANDIDATES);
}

function pickStalkerPortalUrl(
    urls: DetectedUrl[],
    labeled: LabeledFields
): { url: string; confidence: ProviderImportConfidence } | null {
    const shaped = urls.find((url) => url.role === 'stalker');
    if (shaped) {
        return { url: shaped.raw, confidence: 'high' };
    }
    const labeledUrl = labeledHostUrl(labeled);
    if (labeledUrl) {
        return { url: labeledUrl, confidence: 'high' };
    }
    const generic = urls.find((url) => url.role === 'generic');
    if (generic) {
        return { url: generic.raw, confidence: 'medium' };
    }
    return null;
}

function safeXtreamServerUrl(raw: string): string | undefined {
    try {
        return normalizeXtreamServerUrl(raw);
    } catch {
        return undefined;
    }
}

function hostnameOf(url: string | undefined): string | undefined {
    if (!url) {
        return undefined;
    }
    try {
        return new URL(url).hostname;
    } catch {
        return undefined;
    }
}

/** Drops undefined/empty fields so candidates stay clean to render and diff. */
function compact(candidate: ProviderImportCandidate): ProviderImportCandidate {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(candidate)) {
        if (value !== undefined && value !== '') {
            result[key] = value;
        }
    }
    return result as unknown as ProviderImportCandidate;
}

function dedupe(
    candidates: ProviderImportCandidate[]
): ProviderImportCandidate[] {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
        const key = [
            candidate.kind,
            candidate.url ?? '',
            candidate.serverUrl ?? '',
            candidate.username ?? '',
            candidate.portalUrl ?? '',
            candidate.macAddress ?? '',
        ].join('|');
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

const CONFIDENCE_RANK: Record<ProviderImportConfidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
};

function sortByConfidence(
    candidates: ProviderImportCandidate[]
): ProviderImportCandidate[] {
    // Array.prototype.sort is stable, so equal-confidence candidates keep
    // their assembly order: Stalker (strongest signal) → Xtream → M3U.
    return [...candidates].sort(
        (a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
    );
}
