import {
    DetectedUrl,
    extractLabeledFields,
    extractMacAddresses,
    extractUrls,
    foldDecorativeAlphabets,
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
// Guard against pathological pastes, not against real handouts: multi-account
// MAC lists with a dozen entries are legitimate and must all surface.
const MAX_CANDIDATES = 16;

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
    // positions, URL spans and masking agree with each other. NFKC folds the
    // math alphabets; the extra pass folds the squared/negative-circled/
    // regional-indicator "font" letters and circled digits NFKC leaves alone.
    // Both only touch decorative glyphs — ASCII credentials and URLs, hence
    // every emitted value, pass through unchanged.
    const normalized = foldDecorativeAlphabets(raw.normalize('NFKC'));
    const urls = extractUrls(normalized);
    const labeled = extractLabeledFields(normalized, urls);
    const macs = extractMacAddresses(normalized, labeled.macAddress);
    const candidates: ProviderImportCandidate[] = [];

    // ── Stalker: a MAC address is the strongest signal there is. Labeled
    // credentials attach here (Stalker portals can require a login too)
    // rather than seeding a competing Xtream guess.
    //
    // Identity fields attach ONLY when the message names exactly one account:
    // labeled extraction is first-match-wins over the whole text, so with
    // several MACs there is no reliable way to tell whose serial/device ID a
    // label belongs to — and a device ID submitted with the wrong MAC is
    // pinned by the portal permanently. Multi-MAC candidates therefore carry
    // portal + MAC only, and the user supplies identity per account.
    const portal = pickStalkerPortalUrl(urls, labeled);
    const identity: LabeledFields = macs.length === 1 ? labeled : {};
    for (const macAddress of macs) {
        candidates.push(
            compact({
                kind: 'stalker',
                confidence: portal?.confidence ?? 'low',
                portalUrl: portal?.url,
                macAddress,
                serialNumber: identity.serialNumber,
                deviceId1: identity.deviceId1,
                deviceId2: identity.deviceId2,
                signature1: identity.signature1,
                signature2: identity.signature2,
                username: identity.username,
                password: identity.password,
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

    // ── Bare handout: exactly "URL, token, token" and nothing else readable.
    // "http://host\nVictoria89\nVictoria89" carries no labels at all — the
    // shape IS the message (server, then username, then password, in reading
    // order). Deliberately the last resort and ranked low: it only fires when
    // no label, MAC or API URL produced anything, the single URL is generic,
    // and the message contains nothing beyond those three lines, so prose
    // cannot be misread as credentials.
    if (
        macs.length === 0 &&
        !labeled.username &&
        !labeled.password &&
        candidates.length === 0 &&
        urls.length === 1 &&
        urls[0].role === 'generic'
    ) {
        const tokens = bareCredentialTokens(normalized, urls[0]);
        if (tokens) {
            candidates.push(
                compact({
                    kind: 'xtream',
                    confidence: 'low',
                    serverUrl: safeXtreamServerUrl(urls[0].raw),
                    username: tokens[0],
                    password: tokens[1],
                    suggestedTitle: urls[0].parsed.hostname,
                })
            );
        }
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

/**
 * For the bare "URL, token, token" shape: returns the two credential-shaped
 * tokens when the message consists of exactly three non-empty lines — the
 * URL and two single tokens — and nothing else.
 */
function bareCredentialTokens(
    text: string,
    url: DetectedUrl
): [string, string] | null {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    if (lines.length !== 3) {
        return null;
    }
    const tokens = lines.filter((line) => !line.includes(url.raw));
    if (tokens.length !== 2) {
        return null;
    }
    const credentialShaped = /^[A-Za-z0-9._@-]{3,64}$/;
    return credentialShaped.test(tokens[0]) && credentialShaped.test(tokens[1])
        ? [tokens[0], tokens[1]]
        : null;
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
            // Same server + username with a DIFFERENT password is a distinct
            // account (e.g. a rotation message) — never collapse it away.
            candidate.password ?? '',
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
