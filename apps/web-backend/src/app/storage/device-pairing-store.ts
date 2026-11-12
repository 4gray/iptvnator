import {
    createHash,
    randomBytes,
    randomInt,
    randomUUID,
    timingSafeEqual,
} from 'node:crypto';
import type { Database } from 'better-sqlite3';

const LIFETIME = 5 * 60_000;
const MAX_PENDING = 100;
type Claim = {
    secret: string;
    name: string;
    code: string;
    expires: number;
    approved: boolean;
};
const secret = () => randomBytes(32).toString('base64url');
const digest = (value: string) =>
    createHash('sha256').update(value).digest('hex');

/** Invitations and pending claims die with the process; only token digests persist. */
export class DevicePairingStore {
    private readonly invites = new Map<string, number>();
    private readonly claims = new Map<string, Claim>();
    constructor(
        private readonly db: Database,
        private readonly now = Date.now
    ) {
        db.exec(
            'CREATE TABLE IF NOT EXISTS server_paired_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_digest TEXT NOT NULL UNIQUE)'
        );
    }
    private prune(): void {
        const now = this.now();
        for (const [id, expires] of this.invites)
            if (expires <= now) this.invites.delete(id);
        for (const [id, claim] of this.claims)
            if (claim.expires <= now) this.claims.delete(id);
    }
    invite(): { inviteId: string; expiresAt: string } | null {
        this.prune();
        if (this.invites.size + this.claims.size >= MAX_PENDING) return null;
        const id = secret();
        const expires = this.now() + LIFETIME;
        this.invites.set(id, expires);
        return { inviteId: id, expiresAt: new Date(expires).toISOString() };
    }
    claim(
        inviteId: string,
        name: string
    ): {
        claimId: string;
        claimSecret: string;
        confirmationCode: string;
    } | null {
        this.prune();
        if (!this.invites.delete(inviteId)) return null;
        const claimId = secret();
        const claimSecret = secret();
        const confirmationCode = String(randomInt(0, 1_000_000)).padStart(
            6,
            '0'
        );
        this.claims.set(claimId, {
            secret: digest(claimSecret),
            name,
            code: confirmationCode,
            expires: this.now() + LIFETIME,
            approved: false,
        });
        return { claimId, claimSecret, confirmationCode };
    }
    approve(id: string): boolean {
        this.prune();
        const claim = this.claims.get(id);
        if (!claim) return false;
        claim.approved = true;
        return true;
    }
    complete(
        id: string,
        supplied: string
    ): { status: 'pending' } | { status: 'approved'; token: string } | null {
        this.prune();
        const claim = this.claims.get(id);
        const suppliedDigest = Buffer.from(digest(supplied), 'hex');
        if (
            !claim ||
            !timingSafeEqual(Buffer.from(claim.secret, 'hex'), suppliedDigest)
        )
            return null;
        if (!claim.approved) return { status: 'pending' };
        const token = secret();
        this.db
            .prepare(
                'INSERT INTO server_paired_devices (id, name, token_digest) VALUES (?, ?, ?)'
            )
            .run(randomUUID(), claim.name, digest(token));
        this.claims.delete(id);
        return { status: 'approved', token };
    }
    list() {
        this.prune();
        return {
            pending: Array.from(this.claims, ([claimId, claim]) => ({
                claimId,
                name: claim.name,
                confirmationCode: claim.code,
            })),
            devices: this.db
                .prepare(
                    'SELECT id, name FROM server_paired_devices ORDER BY rowid'
                )
                .all(),
        };
    }
    revoke(id: string): boolean {
        return (
            this.db
                .prepare('DELETE FROM server_paired_devices WHERE id = ?')
                .run(id).changes > 0
        );
    }
    accepts(token: string): boolean {
        return !!this.db
            .prepare(
                'SELECT 1 FROM server_paired_devices WHERE token_digest = ?'
            )
            .get(digest(token));
    }
}
