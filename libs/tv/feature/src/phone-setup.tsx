import { useEffect, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import {
    createPairing,
    finishPairing,
    pairingState,
    PairingSession,
    PairingState,
} from '@iptvnator/tv/data-access';
import { parseSourceDraft } from '@iptvnator/tv/util';
import { restoreFocus } from '@iptvnator/tv/ui';
import { TvModel } from './use-tv';
export function PhoneSetup({ tv }: { tv: TvModel }) {
    const [session, setSession] = useState<PairingSession>();
    const [state, setState] = useState<PairingState>();
    const [qr, setQr] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [remaining, setRemaining] = useState(0);
    const saved = useRef(false);
    const pendingSave = useRef<Promise<void>>();
    const owner = useRef<{ session: PairingSession; backend: string }>();
    const operation = useRef<AbortController>();
    useEffect(
        () => () => {
            operation.current?.abort();
            const current = owner.current;
            if (current)
                void (pendingSave.current ?? Promise.resolve())
                    .catch(() => undefined)
                    .then(() =>
                        finishPairing(
                            current.backend,
                            current.session,
                            saved.current ? 'saved' : 'cancelled',
                            new AbortController().signal
                        )
                    )
                    .catch(() => undefined);
        },
        []
    );
    async function start() {
        operation.current?.abort();
        const abort = new AbortController();
        operation.current = abort;
        setBusy(true);
        setError('');
        saved.current = false;
        pendingSave.current = undefined;
        try {
            const next = await createPairing(
                tv.data.backend,
                tv.data.backendToken,
                abort.signal
            );
            if (abort.signal.aborted) return;
            owner.current = { session: next, backend: tv.data.backend };
            const url = `${tv.data.backend}/tv/setup#${next.id}.${next.phoneToken}`;
            setQr(
                await QRCode.toDataURL(url, {
                    width: 360,
                    margin: 4,
                    errorCorrectionLevel: 'M',
                })
            );
            if (abort.signal.aborted) return;
            setState(undefined);
            setSession(next);
            setRemaining(Math.ceil((next.expiresAt - Date.now()) / 1000));
            restoreFocus('phone-cancel');
        } catch {
            if (!abort.signal.aborted)
                setError(
                    'Phone setup could not start. Check the backend connection.'
                );
        } finally {
            if (!abort.signal.aborted) setBusy(false);
        }
    }
    useEffect(() => {
        if (!session) return;
        const abort = new AbortController();
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            if (abort.signal.aborted) return;
            const seconds = Math.max(
                0,
                Math.ceil((session.expiresAt - Date.now()) / 1000)
            );
            setRemaining(seconds);
            if (!seconds) {
                setError(
                    'This QR code expired. Close it and create a new one.'
                );
                return;
            }
            try {
                const next = await pairingState(
                    owner.current!.backend,
                    session,
                    abort.signal
                );
                if (abort.signal.aborted) return;
                setState((previous) => {
                    if (
                        next.status === 'pending' &&
                        previous?.status !== 'pending'
                    )
                        restoreFocus('phone-confirm');
                    return next;
                });
            } catch {
                if (!abort.signal.aborted)
                    setError(
                        'Connection interrupted. Retrying until this code expires.'
                    );
            }
            if (!abort.signal.aborted) timer = setTimeout(poll, 1200);
        };
        void poll();
        return () => {
            abort.abort();
            clearTimeout(timer);
        };
    }, [session]);
    async function finish(outcome: 'saved' | 'rejected' | 'cancelled') {
        if (!session || !owner.current) return;
        const abort = new AbortController();
        operation.current = abort;
        setBusy(true);
        setError('');
        try {
            if (outcome === 'saved' && !saved.current) {
                const current = await pairingState(
                    owner.current.backend,
                    session,
                    abort.signal
                );
                if (abort.signal.aborted) return;
                if (current.status !== 'pending' || !current.source)
                    throw new Error('expired');
                const source = {
                    ...parseSourceDraft(current.source),
                    id: `phone-${session.id}`,
                };
                pendingSave.current = tv
                    .update((data) => ({
                        ...data,
                        activeId: source.id,
                        sources: [
                            ...data.sources.filter((s) => s.id !== source.id),
                            source,
                        ],
                    }))
                    .then(() => {
                        saved.current = true;
                    });
                await pendingSave.current;
            }
            if (abort.signal.aborted) return;
            await finishPairing(
                owner.current.backend,
                session,
                outcome,
                abort.signal
            );
            owner.current = undefined;
            setSession(undefined);
            setQr('');
            setState(undefined);
            if (outcome === 'saved') tv.navigate('home');
            else restoreFocus('phone-start');
        } catch {
            if (!abort.signal.aborted)
                setError(
                    saved.current
                        ? 'Saved on this TV. Retry to deliver confirmation to your phone.'
                        : 'The source was not added. Check TV storage and connection, then retry.'
                );
        } finally {
            if (!abort.signal.aborted) setBusy(false);
        }
    }
    return (
        <section class="phone-setup" aria-label="Add from phone">
            <div>
                <h2>Add from your phone</h2>
                <p class="muted">
                    Scan, paste your source details, then confirm here.
                </p>
            </div>
            {!session ? (
                <button
                    type="button"
                    class="primary"
                    data-focus="phone-start"
                    disabled={!tv.backend.connected || busy}
                    onClick={() => void start()}
                >
                    {busy ? 'Preparing QR…' : 'Add from phone'}
                </button>
            ) : (
                <div class="phone-pairing">
                    {state?.source ? (
                        <div class="phone-review">
                            <p class="eyebrow">RECEIVED FROM YOUR PHONE</p>
                            <h3>{state.source.name}</h3>
                            <p>
                                {state.source.provider.toUpperCase()} ·{' '}
                                {new URL(state.source.url).hostname}
                            </p>
                            <p class="muted">Add this source to your TV?</p>
                            <div class="actions">
                                <button
                                    type="button"
                                    class="primary"
                                    data-focus="phone-confirm"
                                    disabled={busy || !remaining}
                                    onClick={() => void finish('saved')}
                                >
                                    {busy
                                        ? 'Saving…'
                                        : saved.current
                                          ? 'Retry confirmation'
                                          : 'Add source'}
                                </button>
                                <button
                                    type="button"
                                    disabled={busy || saved.current}
                                    onClick={() => void finish('rejected')}
                                >
                                    Decline
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <img
                                class="pairing-qr"
                                src={qr}
                                alt="Scan this QR code to add a source from your phone"
                            />
                            <div>
                                <h3>Open your phone’s camera</h3>
                                <p>Keep your phone on the same home network.</p>
                                <p class="muted" role="status">
                                    Waiting for your phone ·{' '}
                                    {Math.floor(remaining / 60)}:
                                    {String(remaining % 60).padStart(2, '0')}
                                </p>
                            </div>
                        </>
                    )}
                    <button
                        type="button"
                        data-focus="phone-cancel"
                        disabled={busy}
                        onClick={() => {
                            if (!remaining || saved.current) {
                                owner.current = undefined;
                                setSession(undefined);
                                setQr('');
                                setState(undefined);
                                setError('');
                                restoreFocus('phone-start');
                            } else void finish('cancelled');
                        }}
                    >
                        Close setup
                    </button>
                </div>
            )}
            {!tv.backend.connected && !session ? (
                <p class="muted">
                    Connect a backend below to enable phone setup.
                </p>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
        </section>
    );
}
