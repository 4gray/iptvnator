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
 *    unchanged. The one deliberate exception is `labeledHostUrl`, which
 *    completes a scheme-less labeled host with `http://` and a separately
 *    labeled port — an assembled value, landing in an editable form field.
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
// DOM-safety guard against pathological pastes, not a business limit: sized
// above the scanners' combined caps (64 MACs + 64 URLs — a get.php URL can
// yield both an xtream and an m3u-url candidate), so every candidate a real
// multi-account handout produces survives the final slice.
const MAX_CANDIDATES = 160;

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
    const labeled = extractLabeledFields(normalized);
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
    // Several MACs meeting portal candidates on DIFFERENT hosts is two
    // accounts from two panels in one paste — there is no deterministic way
    // to say which MAC belongs to which portal, so those candidates carry the
    // MAC alone instead of prefilling half of them with the wrong panel.
    // The ambiguity is judged over the POOL `pickStalkerPortalUrl` would
    // actually draw from: portal-shaped URLs when any exist, otherwise the
    // generic-URL fallback — a guard on the shaped pool alone would let two
    // root-URL panels slip through the fallback door. A single labeled
    // "Portal:" line, same-host Real/Panel pairs, and one portal shared by a
    // whole MAC list stay unambiguous. A line naming one MAC and one portal
    // ("http://panel/c | 00:1A:79:…", the shape of provider list files) needs
    // no judgement at all: that pair is attached as-is and withdrawn from the
    // pool the guard judges.
    const linePortals = linePairedPortals(normalized);
    const pairedUrls = new Set(
        Array.from(linePortals.values(), (pair) => pair.url)
    );
    // A labeled portal a line already claimed belongs to that account; it
    // must not compete for a MAC the guard has left.
    const remainingLabeled = pairedUrls.has(labeledHostUrl(labeled) ?? '')
        ? { ...labeled, host: undefined }
        : labeled;
    const remainingUrls = urls.filter(
        (url) =>
            !pairedUrls.has(completeWithLabeledPort(url, remainingLabeled.port))
    );
    const unpairedMacs = macs.filter((mac) => !linePortals.has(mac));
    const shapedPortals = remainingUrls.filter((url) => url.role === 'stalker');
    const portalPool =
        shapedPortals.length > 0
            ? shapedPortals
            : labeledHostUrl(remainingLabeled) !== undefined
              ? []
              : remainingUrls.filter((url) => url.role === 'generic');
    const portalAmbiguous =
        unpairedMacs.length > 1 &&
        new Set(
            portalPool.map((url) =>
                portalInstallationKey(url, remainingLabeled.port)
            )
        ).size > 1;
    const portal = portalAmbiguous
        ? null
        : pickStalkerPortalUrl(remainingUrls, remainingLabeled);
    const identity: LabeledFields = macs.length === 1 ? labeled : {};
    for (const macAddress of macs) {
        const attached = linePortals.get(macAddress) ?? portal;
        candidates.push(
            compact({
                kind: 'stalker',
                confidence: attached?.confidence ?? 'low',
                portalUrl: attached?.url,
                macAddress,
                serialNumber: identity.serialNumber,
                deviceId1: identity.deviceId1,
                deviceId2: identity.deviceId2,
                signature1: identity.signature1,
                signature2: identity.signature2,
                username: identity.username,
                password: identity.password,
                suggestedTitle: hostnameOf(attached?.url),
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
        // A separately labeled "Port:" completes a port-less API URL, same
        // as the labeled-host fallback already does.
        const completedRaw = completeWithLabeledPort(url, labeled.port);
        candidates.push(
            compact({
                kind: 'xtream',
                confidence: username && password ? 'high' : 'medium',
                serverUrl: safeXtreamServerUrl(completedRaw),
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
                url: completedRaw,
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

/**
 * Ambiguity key for a portal candidate: origin plus the installation's base
 * path. Origin (not hostname) separates panels on different ports while URL
 * normalization drops default ports, so the Real/Panel `:80`-vs-bare pairs
 * of scanner dumps compare equal. The base path separates tenant installs
 * sharing one origin (`/a/stalker_portal/c/` vs `/b/…`), while the known
 * endpoint suffixes of ONE install (`/c/`, `portal.php`, `server/load.php`)
 * are stripped so its alternate endpoints reduce to the same key. The key is
 * derived AFTER labeled-port completion, so `http://panel:8080/c/` next to
 * `http://panel/c/` plus a `Port: 8080` line reads as one panel, exactly as
 * the picker would complete it.
 */
function portalInstallationKey(
    url: DetectedUrl,
    labeledPort: string | undefined
): string {
    let parsed = url.parsed;
    const completed = completeWithLabeledPort(url, labeledPort);
    if (completed !== url.raw) {
        try {
            parsed = new URL(completed);
        } catch {
            parsed = url.parsed;
        }
    }
    const base = parsed.pathname
        .replace(/\/(?:stalker_portal\/)?c\/?$/i, '')
        .replace(/\/stalker_portal\/?$/i, '')
        .replace(/\/portal\.php$/i, '')
        .replace(/\/(?:stalker_portal\/)?server\/load\.php$/i, '')
        .replace(/\/+$/, '');
    return `${parsed.origin}${base}`;
}

/**
 * Completes a found URL with a separately labeled port — "Portal: http://x/…"
 * plus "Port: 8080" on its own line is a real handout shape (corpus #5).
 * Applied only when the URL itself states no explicit port, so a written
 * `:80` is never overridden by the label.
 */
/**
 * Whether the URL states a port itself. Read off the RAW authority rather
 * than `parsed.port`, which the WHATWG parser blanks for a protocol's default
 * (`http://host:80` reports no port) — a written `:80` is still the user's
 * explicit choice and must not be overwritten by a labeled one. An IPv6
 * literal's own colons are skipped by cutting the bracketed address first.
 */
function hasExplicitPort(raw: string): boolean {
    const afterScheme = raw.slice(raw.indexOf('://') + 3);
    const authority = afterScheme.split(/[/?#]/, 1)[0];
    const afterAddress = authority.startsWith('[')
        ? authority.slice(authority.indexOf(']') + 1)
        : authority;
    return /:\d+$/.test(afterAddress);
}

function completeWithLabeledPort(
    url: DetectedUrl,
    port: string | undefined
): string {
    if (!port || hasExplicitPort(url.raw)) {
        return url.raw;
    }
    const { protocol, hostname, pathname, search } = url.parsed;
    return `${protocol}//${hostname}:${port}${pathname}${search}`;
}

/**
 * Portal/MAC pairs stated by a single line. Provider list files hand out one
 * account per line — "http://panel/c | 00:1A:79:…" — so when a pasted block
 * spans several panels, co-occurrence on one line is the only deterministic
 * statement of which portal owns which MAC. A line pairs only when it names
 * exactly one MAC and exactly one usable URL (portal-shaped, or a lone root
 * URL); a line listing several MACs stays for the ambiguity guard.
 */
function linePairedPortals(
    text: string
): Map<string, { url: string; confidence: ProviderImportConfidence }> {
    const pairs = new Map<
        string,
        { url: string; confidence: ProviderImportConfidence }
    >();
    for (const line of text.split(/\r?\n/)) {
        const macs = extractMacAddresses(line, undefined);
        if (macs.length !== 1 || pairs.has(macs[0])) {
            continue;
        }
        const urls = extractUrls(line);
        const shaped = urls.find((url) => url.role === 'stalker');
        if (shaped) {
            pairs.set(macs[0], { url: shaped.raw, confidence: 'high' });
        } else if (urls.length === 1 && urls[0].role === 'generic') {
            pairs.set(macs[0], { url: urls[0].raw, confidence: 'medium' });
        }
    }
    return pairs;
}

function pickStalkerPortalUrl(
    urls: DetectedUrl[],
    labeled: LabeledFields
): { url: string; confidence: ProviderImportConfidence } | null {
    const shaped = urls.find((url) => url.role === 'stalker');
    if (shaped) {
        return {
            url: completeWithLabeledPort(shaped, labeled.port),
            confidence: 'high',
        };
    }
    const labeledUrl = labeledHostUrl(labeled);
    if (labeledUrl) {
        return { url: labeledUrl, confidence: 'high' };
    }
    const generic = urls.find((url) => url.role === 'generic');
    if (generic) {
        return {
            url: completeWithLabeledPort(generic, labeled.port),
            confidence: 'medium',
        };
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
        // JSON rather than a joined string: a credential may legitimately
        // contain the separator (URL-encoded in the query), and two different
        // accounts must never collapse into one key because of it. Same
        // server + username with a DIFFERENT password is a distinct account
        // (e.g. a rotation message), so the password is part of the key.
        const key = JSON.stringify([
            candidate.kind,
            candidate.url ?? '',
            candidate.serverUrl ?? '',
            candidate.username ?? '',
            candidate.password ?? '',
            candidate.portalUrl ?? '',
            candidate.macAddress ?? '',
        ]);
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
