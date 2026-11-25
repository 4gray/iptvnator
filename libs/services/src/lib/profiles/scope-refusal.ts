/** The server refuses a personal scope that is gone or switched off (HTTP 409). */
export const SCOPE_REFUSALS = ['profile_missing', 'profiles_disabled'] as const;
export type ScopeRefusal = (typeof SCOPE_REFUSALS)[number];

/** The refusal in a failed response, or null for any other failure. */
export function scopeRefusalOf(
    status: number,
    body: unknown
): ScopeRefusal | null {
    const code = (body as { code?: unknown } | null | undefined)?.code;
    return status === 409 &&
        (SCOPE_REFUSALS as readonly unknown[]).includes(code)
        ? (code as ScopeRefusal)
        : null;
}
