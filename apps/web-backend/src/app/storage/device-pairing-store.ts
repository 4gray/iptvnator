import {
    createHash,
    randomBytes,
    randomInt,
    randomUUID,
    scryptSync,
    timingSafeEqual,
} from 'node:crypto';
import type { Database } from 'better-sqlite3';

const LIFETIME = 5 * 60_000;
const MAX_PENDING = 100;
type Claim = {
    inviteId: string | null;
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
    private readonly invites = new Map<string, {
        expires: number;
        origin?: string;
        cloudflare: boolean;
        approverId?: string;
    }>();
    private readonly claims = new Map<string, Claim>();
    private readonly sessions = new Map<string, number>();
    constructor(
        private readonly db: Database,
        private readonly now = Date.now
    ) {
        db.exec(
            'CREATE TABLE IF NOT EXISTS server_paired_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_digest TEXT NOT NULL UNIQUE)'
        );
        const columns = db.pragma('table_info(server_paired_devices)') as {
            name: string;
        }[];
        if (!columns.some((column) => column.name === 'can_approve'))
            db.exec(
                'ALTER TABLE server_paired_devices ADD COLUMN can_approve INTEGER NOT NULL DEFAULT 0'
            );
        if (!columns.some((column) => column.name === 'cloudflare'))
            db.exec('ALTER TABLE server_paired_devices ADD COLUMN cloudflare INTEGER NOT NULL DEFAULT 0');
        if (!columns.some((column) => column.name === 'revoked'))
            db.exec('ALTER TABLE server_paired_devices ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0');
        db.exec(
            'CREATE TABLE IF NOT EXISTS server_pairing_settings (id INTEGER PRIMARY KEY CHECK(id = 1), password_hash TEXT NOT NULL)'
        );
    }
    private prune(): void {
        const now = this.now();
        for (const [id, { expires }] of this.invites)
            if (expires <= now) this.invites.delete(id);
        for (const [id, claim] of this.claims)
            if (claim.expires <= now) this.claims.delete(id);
    }
    invite(origin?: string, cloudflare = false, approverId?: string): { inviteId: string; expiresAt: string } | null {
        this.prune();
        if (this.invites.size + this.claims.size >= MAX_PENDING) return null;
        const id = secret();
        const expires = this.now() + LIFETIME;
        this.invites.set(id, { expires, origin, cloudflare, approverId });
        return { inviteId: id, expiresAt: new Date(expires).toISOString() };
    }
    claim(
        inviteId: string,
        name: string,
        origin?: string
    ): {
        claimId: string;
        claimSecret: string;
        confirmationCode: string;
    } | null {
        this.prune();
        const invite = this.invites.get(inviteId);
        if (!invite || invite.cloudflare || (invite.origin && invite.origin !== origin)) return null;
        this.invites.delete(inviteId);
        const result = this.start(name, inviteId);
        if (!result) return null;
        const { claimId, claimSecret, confirmationCode } = result;
        return { claimId, claimSecret, confirmationCode };
    }
    start(name: string, inviteId: string | null = null) {
        this.prune();
        if (this.invites.size + this.claims.size >= MAX_PENDING) return null;
        const claimId = secret();
        const claimSecret = secret();
        const confirmationCode = String(randomInt(0, 1_000_000)).padStart(
            6,
            '0'
        );
        const expires = this.now() + LIFETIME;
        this.claims.set(claimId, {
            inviteId,
            secret: digest(claimSecret),
            name,
            code: confirmationCode,
            expires,
            approved: false,
        });
        return {
            claimId,
            claimSecret,
            confirmationCode,
            expiresAt: new Date(expires).toISOString(),
        };
    }
    passwordConfigured(): boolean {
        return !!this.db
            .prepare('SELECT 1 FROM server_pairing_settings WHERE id = 1')
            .get();
    }
    setPassword(password: string | null): void {
        if (password === null)
            this.db
                .prepare('DELETE FROM server_pairing_settings WHERE id = 1')
                .run();
        else {
            const salt = randomBytes(16).toString('hex');
            const hash = scryptSync(password, salt, 32).toString('hex');
            this.db
                .prepare(
                    'INSERT OR REPLACE INTO server_pairing_settings (id, password_hash) VALUES (1, ?)'
                )
                .run(`${salt}:${hash}`);
        }
        this.sessions.clear();
    }
    createSession(password: string): string | null {
        const row = this.db
            .prepare(
                'SELECT password_hash FROM server_pairing_settings WHERE id = 1'
            )
            .get() as { password_hash: string } | undefined;
        if (!row) return null;
        const [salt, hash] = row.password_hash.split(':');
        const actual = scryptSync(password, salt, 32);
        const expected = Buffer.from(hash, 'hex');
        if (
            expected.length !== actual.length ||
            !timingSafeEqual(actual, expected)
        )
            return null;
        const now = this.now();
        for (const [id, expires] of this.sessions)
            if (expires <= now) this.sessions.delete(id);
        if (this.sessions.size >= 100) return null;
        const token = secret();
        this.sessions.set(digest(token), now + LIFETIME);
        return token;
    }
    acceptsSession(token: string): boolean {
        const key = digest(token);
        const expires = this.sessions.get(key) ?? 0;
        if (expires <= this.now()) {
            this.sessions.delete(key);
            return false;
        }
        return true;
    }
    browserRequest(
        id: string
    ): { name: string; confirmationCode: string } | null {
        this.prune();
        const claim = this.claims.get(id);
        if (!claim || claim.inviteId !== null || claim.approved) return null;
        return { name: claim.name, confirmationCode: claim.code };
    }
    browserApprove(id: string): boolean {
        return !!this.browserRequest(id) && this.approve(id);
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
    cloudflareDevice(key: string): 'active' | 'revoked' | 'unknown' {
        const row = this.db.prepare(
            'SELECT revoked FROM server_paired_devices WHERE token_digest = ? AND cloudflare = 1'
        ).get(digest(key)) as { revoked: number } | undefined;
        return !row ? 'unknown' : row.revoked ? 'revoked' : 'active';
    }
    registerCloudflareDevice(inviteId: string, origin: string, name: string, key: string) {
        const state = this.cloudflareDevice(key);
        if (state === 'active') return state;
        this.prune();
        const invite = this.invites.get(inviteId);
        if (!invite?.cloudflare || invite.origin !== origin) return state;
        if (invite.approverId && !this.db.prepare(
            'SELECT 1 FROM server_paired_devices WHERE id = ? AND cloudflare = 1 AND revoked = 0 AND can_approve = 1'
        ).get(invite.approverId)) return state;
        if (state === 'revoked') {
            this.db.prepare(
                'UPDATE server_paired_devices SET revoked = 0, name = ? WHERE token_digest = ? AND cloudflare = 1'
            ).run(name, digest(key));
        } else {
            this.db.prepare(
                'INSERT INTO server_paired_devices (id, name, token_digest, cloudflare) VALUES (?, ?, ?, 1)'
            ).run(randomUUID(), name, digest(key));
        }
        this.invites.delete(inviteId);
        return 'active';
    }
    list(cloudflare = false, inviteId?: string) {
        this.prune();
        return {
            ...(cloudflare && inviteId
                ? { inviteActive: this.invites.get(inviteId)?.cloudflare === true }
                : {}),
            pending: cloudflare ? [] : Array.from(this.claims, ([claimId, claim]) => ({
                claimId,
                inviteId: claim.inviteId,
                name: claim.name,
                confirmationCode: claim.code,
            })),
            devices: this.db
                .prepare(
                    'SELECT id, name, can_approve AS canApprove FROM server_paired_devices WHERE cloudflare = ? AND revoked = 0 ORDER BY rowid'
                )
                .all(cloudflare ? 1 : 0)
                .map((row) => {
                    const device = row as {
                        id: string;
                        name: string;
                        canApprove: number;
                    };
                    return { ...device, canApprove: device.canApprove === 1 };
                }),
        };
    }
    cloudflareApprover(key: string): string | undefined {
        const row = this.db.prepare(
            'SELECT id FROM server_paired_devices WHERE token_digest = ? AND cloudflare = 1 AND revoked = 0 AND can_approve = 1'
        ).get(digest(key)) as { id: string } | undefined;
        return row?.id;
    }
    setApproval(id: string, canApprove: boolean, cloudflare = false): boolean {
        if (cloudflare && !canApprove) this.retractInvites(id);
        return (
            this.db
                .prepare(
                    'UPDATE server_paired_devices SET can_approve = ? WHERE id = ? AND cloudflare = ? AND revoked = 0'
                )
                .run(canApprove ? 1 : 0, id, cloudflare ? 1 : 0).changes > 0
        );
    }
    canApprove(token: string): boolean {
        return !!this.db
            .prepare(
                'SELECT 1 FROM server_paired_devices WHERE token_digest = ? AND can_approve = 1 AND cloudflare = 0'
            )
            .get(digest(token));
    }
    revoke(id: string, cloudflare = false): boolean {
        if (cloudflare) this.retractInvites(id);
        return (
            this.db
                .prepare(cloudflare
                     ? 'UPDATE server_paired_devices SET revoked = 1, can_approve = 0 WHERE id = ? AND cloudflare = 1 AND revoked = 0'
                    : 'DELETE FROM server_paired_devices WHERE id = ? AND cloudflare = 0')
                .run(id).changes > 0
        );
    }

    private retractInvites(id: string): void {
        for (const [inviteId, invite] of this.invites)
            if (invite.approverId === id) this.invites.delete(inviteId);
    }
    accepts(token: string): boolean {
        return !!this.db
            .prepare(
                'SELECT 1 FROM server_paired_devices WHERE token_digest = ? AND cloudflare = 0'
            )
            .get(digest(token));
    }
}
