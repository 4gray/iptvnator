import { SourceDraft } from '@iptvnator/tv/util';
import { backendJson } from './backend';
export interface PairingSession {
    id: string;
    tvToken: string;
    phoneToken: string;
    expiresAt: number;
}
export interface PairingState {
    status: 'waiting' | 'pending' | 'saved' | 'rejected' | 'cancelled';
    source?: SourceDraft;
    expiresAt: number;
}
export function createPairing(
    backend: string,
    accessToken: string,
    signal: AbortSignal
): Promise<PairingSession> {
    return backendJson(`${backend}/tv/pairing`, signal, {
        method: 'POST',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
}
export function pairingState(
    backend: string,
    session: PairingSession,
    signal: AbortSignal
): Promise<PairingState> {
    return backendJson(`${backend}/tv/pairing/${session.id}/tv`, signal, {
        headers: { 'X-TV-Pairing': session.tvToken },
    });
}
export function finishPairing(
    backend: string,
    session: PairingSession,
    outcome: 'saved' | 'rejected' | 'cancelled',
    signal: AbortSignal
) {
    return backendJson(`${backend}/tv/pairing/${session.id}/tv`, signal, {
        method: 'POST',
        headers: {
            'X-TV-Pairing': session.tvToken,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ outcome }),
    });
}
