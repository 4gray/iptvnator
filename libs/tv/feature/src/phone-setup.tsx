import { PhoneReview } from './phone-review';
import { PhoneInstructions, PhoneSetupPanel } from './phone-setup-panel';
import { useEffect, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import {
    createPairing,
    finishPairing,
    pairingState,
    PairingSession,
    PairingState,
} from '@iptvnator/tv/data-access';
import {
    parseSourceDraft,
    applySettingsDraft,
    phoneSettingsDefaults,
    SetupPurpose,
} from '@iptvnator/tv/util';
import { restoreFocus } from '@iptvnator/tv/ui';
import { TvModel } from './use-tv';
export function PhoneSetup({
    tv,
    purpose = 'source',
    compact = false,
    onSettingsApplied,
}: {
    tv: TvModel;
    purpose?: SetupPurpose;
    compact?: boolean;
    onSettingsApplied?: () => void;
}) {
    const settings = purpose === 'settings';
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
                abort.signal,
                purpose,
                settings ? phoneSettingsDefaults(tv.data) : undefined
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
                if (
                    current.status !== 'pending' ||
                    (settings ? !current.settings : !current.source)
                )
                    throw new Error('expired');
                const source = {
                    ...(!settings ? parseSourceDraft(current.source) : {}),
                    id: `phone-${session.id}`,
                };
                pendingSave.current = tv
                    .update((data) =>
                        settings
                            ? applySettingsDraft(data, current.settings)
                            : {
                                  ...data,
                                  activeId: source.id,
                                  sources: [
                                      ...data.sources.filter(
                                          (s) => s.id !== source.id
                                      ),
                                      source as import('@iptvnator/tv/util').Source,
                                  ],
                              }
                    )
                    .then(() => {
                        saved.current = true;
                        // Receipt delivery can fail independently of this committed write.
                        if (settings) onSettingsApplied?.();
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
            if (outcome === 'saved')
                tv.navigate(settings ? 'settings' : 'home');
            else restoreFocus('phone-start');
        } catch {
            if (!abort.signal.aborted)
                setError(
                    saved.current
                        ? 'Saved on this TV. Retry to deliver confirmation to your phone.'
                        : 'Changes were not saved. Check TV storage, connection and required fields, then retry.'
                );
        } finally {
            if (!abort.signal.aborted) setBusy(false);
        }
    }
    return (
        <section
            class={`phone-setup ${compact ? 'compact-phone-setup' : ''}`}
            aria-label={settings ? 'Settings from phone' : 'Add from phone'}
        >
            <div hidden={compact}>
                <h2>
                    {settings
                        ? 'Set up from your phone'
                        : 'Add from your phone'}
                </h2>
                <p class="muted">
                    {settings
                        ? 'Paste your TMDB key and adjust TV settings, then confirm here.'
                        : 'Scan, paste your source details, then confirm here.'}
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
                    {busy
                        ? 'Preparing QR…'
                        : settings
                          ? 'Set up from phone'
                          : 'Add from phone'}
                </button>
            ) : (
                <PhoneSetupPanel compact={compact}>
                    {state?.source || state?.settings ? (
                        <PhoneReview
                            state={state}
                            busy={busy}
                            remaining={remaining}
                            saved={saved.current}
                            confirm={() => void finish('saved')}
                            decline={() => void finish('rejected')}
                        />
                    ) : (
                        <PhoneInstructions qr={qr} remaining={remaining} />
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
                </PhoneSetupPanel>
            )}
            {!tv.backend.connected && !session ? (
                <p class="muted">Connect a backend to enable phone setup.</p>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
        </section>
    );
}
