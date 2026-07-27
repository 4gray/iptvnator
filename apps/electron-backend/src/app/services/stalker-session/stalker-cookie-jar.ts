import { Cookie, CookieJar } from 'tough-cookie';

const MANAGED_COOKIE_NAMES = ['mac', 'stb_lang', 'timezone'] as const;
const MANAGED_COOKIE_NAME_SET = new Set<string>(MANAGED_COOKIE_NAMES);
const COOKIE_VALUE_PATTERN = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/;

type StalkerManagedCookieName = (typeof MANAGED_COOKIE_NAMES)[number];

export type StalkerManagedCookies = Readonly<
    Partial<Record<StalkerManagedCookieName, string>>
>;

export interface StalkerCookieJarOptions {
    now?: () => Date;
}

/**
 * Main-process-only Stalker cookie state.
 *
 * The native jar and managed identity values are private fields on purpose:
 * this wrapper has no serialization API and cannot accidentally become an IPC
 * DTO. Candidate isolation uses {@link clone} instead.
 */
export class StalkerCookieJar {
    #jar: CookieJar;
    readonly #managedCookies: StalkerManagedCookies;
    readonly #now: () => Date;

    constructor(
        managedCookies: StalkerManagedCookies = {},
        options: StalkerCookieJarOptions = {}
    ) {
        this.#managedCookies = copyAndValidateManagedCookies(managedCookies);
        this.#now = options.now ?? (() => new Date());
        this.#jar = createNativeCookieJar();
    }

    async collectResponseCookies(
        responseUrl: string,
        setCookieHeaders: string | readonly string[] | undefined
    ): Promise<void> {
        if (setCookieHeaders === undefined) {
            return;
        }

        const headers =
            typeof setCookieHeaders === 'string'
                ? [setCookieHeaders]
                : setCookieHeaders;
        for (const setCookie of headers) {
            const parsed = Cookie.parse(setCookie);
            if (
                !parsed ||
                MANAGED_COOKIE_NAME_SET.has(parsed.key.toLowerCase())
            ) {
                continue;
            }

            const receivedAt = this.#now();
            normalizeMaxAgeToAbsoluteExpiry(parsed, receivedAt);
            await this.#jar.setCookie(parsed, responseUrl, {
                http: true,
                ignoreError: true,
                loose: false,
                now: receivedAt,
            });
        }
    }

    async getCookieHeader(requestUrl: string): Promise<string | undefined> {
        const now = this.#now();
        const serverCookies = await this.#jar.getCookies(requestUrl, {
            expire: false,
            http: true,
            sort: true,
        });
        const cookieParts = serverCookies
            .filter(
                (cookie) =>
                    !MANAGED_COOKIE_NAME_SET.has(cookie.key.toLowerCase()) &&
                    isUnexpired(cookie, now)
            )
            .map((cookie) => cookie.cookieString());

        for (const name of MANAGED_COOKIE_NAMES) {
            const value = this.#managedCookies[name];
            if (value !== undefined) {
                cookieParts.push(`${name}=${value}`);
            }
        }

        return cookieParts.length > 0 ? cookieParts.join('; ') : undefined;
    }

    async clone(): Promise<StalkerCookieJar> {
        return this.cloneWithManagedCookies(this.#managedCookies);
    }

    async cloneWithManagedCookies(
        managedCookies: StalkerManagedCookies
    ): Promise<StalkerCookieJar> {
        const clone = new StalkerCookieJar(managedCookies, {
            now: this.#now,
        });
        clone.#jar = await this.#jar.clone();
        return clone;
    }
}

function createNativeCookieJar(): CookieJar {
    return new CookieJar(undefined, {
        allowSpecialUseDomain: true,
        looseMode: false,
        prefixSecurity: 'strict',
        rejectPublicSuffixes: true,
    });
}

function copyAndValidateManagedCookies(
    managedCookies: StalkerManagedCookies
): StalkerManagedCookies {
    const result: Partial<Record<StalkerManagedCookieName, string>> = {};
    for (const name of MANAGED_COOKIE_NAMES) {
        const value = managedCookies[name];
        if (value === undefined) {
            continue;
        }
        if (!COOKIE_VALUE_PATTERN.test(value)) {
            throw new Error('invalid-identity-input');
        }
        result[name] = value;
    }
    return Object.freeze(result);
}

function isUnexpired(cookie: Cookie, now: Date): boolean {
    const expiry = cookie.expiryTime();
    return expiry === undefined || expiry > now.getTime();
}

function normalizeMaxAgeToAbsoluteExpiry(
    cookie: Cookie,
    receivedAt: Date
): void {
    if (typeof cookie.maxAge !== 'number' || cookie.maxAge <= 0) {
        return;
    }
    cookie.expires = new Date(receivedAt.getTime() + cookie.maxAge * 1000);
    cookie.maxAge = null;
}
