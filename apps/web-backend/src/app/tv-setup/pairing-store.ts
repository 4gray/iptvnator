import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
    parseSourceDraft,
    SourceDraft,
    parseSettingsDraft,
    SettingsDraft,
    SetupPurpose,
    PhoneSettingsDefaults,
} from '@iptvnator/tv/util';
type Status = 'waiting' | 'pending' | 'saved' | 'rejected' | 'cancelled';
interface Session {
    id: string;
    tvToken: string;
    phoneToken: string;
    expiresAt: number;
    status: Status;
    source?: SourceDraft;
    purpose: SetupPurpose;
    defaults?: PhoneSettingsDefaults;
    settings?: SettingsDraft;
    timer: ReturnType<typeof setTimeout>;
}
export class PairingError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}
/** Memory-only, bounded and time-limited. Phone never receives a TV capability. */
export class PairingStore {
    private sessions = new Map<string, Session>();
    private attempts = new Map<string, { count: number; until: number }>();
    constructor(
        private readonly ttl = 5 * 60_000,
        private readonly now = Date.now
    ) {}
    create(
        ip: string,
        purpose: SetupPurpose = 'source',
        defaults?: PhoneSettingsDefaults
    ) {
        if (!['source', 'settings'].includes(purpose))
            throw new PairingError(400, 'Invalid setup purpose.');
        let safeDefaults: PhoneSettingsDefaults | undefined;
        if (purpose === 'settings') {
            try {
                const parsed = parseSettingsDraft(defaults);
                safeDefaults = {
                    layout: parsed.layout,
                    epg: parsed.epg,
                    tmdb: {
                        enabled: parsed.tmdb.enabled,
                        language: parsed.tmdb.language,
                        hasKey: defaults?.tmdb.hasKey === true,
                    },
                };
            } catch {
                throw new PairingError(400, 'Invalid settings defaults.');
            }
        }
        this.sweep();
        const attempt = this.attempts.get(ip) ?? {
            count: 0,
            until: this.now() + 60_000,
        };
        if (
            ++attempt.count > 6 ||
            this.sessions.size >= 32 ||
            this.attempts.size >= 256
        )
            throw new PairingError(
                429,
                'Too many setup attempts. Try again shortly.'
            );
        this.attempts.set(ip, attempt);
        const token = () => randomBytes(24).toString('base64url');
        const id = token();
        const timer = setTimeout(() => this.sessions.delete(id), this.ttl);
        timer.unref();
        const session: Session = {
            id,
            tvToken: token(),
            phoneToken: token(),
            expiresAt: this.now() + this.ttl,
            status: 'waiting',
            purpose,
            defaults: safeDefaults,
            timer,
        };
        this.sessions.set(id, session);
        const { tvToken, phoneToken, expiresAt } = session;
        return { id, tvToken, phoneToken, expiresAt };
    }
    read(id: string, token: string, role: 'tv' | 'phone') {
        const s = this.authorize(id, token, role);
        return {
            status: s.status,
            purpose: s.purpose,
            ...(s.defaults ? { defaults: s.defaults } : {}),
            ...(role === 'tv' && s.settings ? { settings: s.settings } : {}),
            expiresAt: s.expiresAt,
            ...(role === 'tv' && s.source ? { source: s.source } : {}),
        };
    }
    submit(id: string, token: string, value: unknown) {
        const s = this.authorize(id, token, 'phone');
        if (s.status !== 'waiting')
            throw new PairingError(409, 'This link has already been used.');
        try {
            if (s.purpose === 'settings')
                s.settings = parseSettingsDraft(value);
            else s.source = parseSourceDraft(value);
        } catch (error) {
            throw new PairingError(
                400,
                error instanceof Error ? error.message : 'Invalid source.'
            );
        }
        s.status = 'pending';
        return { status: s.status };
    }
    finish(id: string, token: string, outcome: unknown) {
        const s = this.authorize(id, token, 'tv');
        if (!['saved', 'rejected', 'cancelled'].includes(String(outcome)))
            throw new PairingError(400, 'Invalid result.');
        if (s.status === outcome) return { status: s.status };
        if (
            (outcome !== 'cancelled' && s.status !== 'pending') ||
            ['saved', 'rejected', 'cancelled'].includes(s.status)
        )
            throw new PairingError(
                409,
                'This setup session is already closed.'
            );
        s.status = outcome as Status;
        delete s.source;
        delete s.settings;
        return { status: s.status };
    }
    dispose() {
        this.sessions.forEach((s) => clearTimeout(s.timer));
        this.sessions.clear();
        this.attempts.clear();
    }
    private sweep() {
        for (const [id, s] of this.sessions)
            if (s.expiresAt <= this.now()) {
                clearTimeout(s.timer);
                this.sessions.delete(id);
            }
        for (const [ip, a] of this.attempts)
            if (a.until <= this.now()) this.attempts.delete(ip);
    }
    private authorize(id: string, token: string, role: 'tv' | 'phone') {
        this.sweep();
        const s = this.sessions.get(id);
        if (!s)
            throw new PairingError(
                410,
                'This setup link expired. Open a new QR code on the TV.'
            );
        const expected = Buffer.from(role === 'tv' ? s.tvToken : s.phoneToken);
        const supplied = Buffer.from(token);
        if (
            supplied.length !== expected.length ||
            !timingSafeEqual(supplied, expected)
        )
            throw new PairingError(403, 'This setup link is not valid.');
        return s;
    }
}
