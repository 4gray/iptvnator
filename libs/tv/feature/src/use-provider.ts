import { useEffect, useRef, useState } from 'preact/hooks';
import { createProvider, ProviderTransport } from '@iptvnator/tv/data-access';
import type { ProviderClient, UserData } from '@iptvnator/tv/util';

export function useProvider(
    data: UserData,
    storageReady: boolean,
    retry: number,
    options: {
        reset: () => void;
        report: (message: string) => void;
        update: (change: (data: UserData) => UserData) => Promise<void>;
    }
) {
    const [ready, setReady] = useState(0);
    const [busy, setBusy] = useState(false);
    const provider = useRef<ProviderClient>();
    const owner = useRef('');
    const callbacks = useRef(options);
    callbacks.current = options;
    const active = data.sources.find((s) => s.id === data.activeId);
    const fingerprint = active
        ? JSON.stringify([
              active.id,
              active.provider,
              active.url,
              active.username,
              active.password,
              active.macAddress,
              active.serialNumber,
              active.deviceId1,
              active.deviceId2,
              active.signature1,
              active.signature2,
              active.userAgent,
              active.referrer,
              active.origin,
          ])
        : '';
    const connectionKey = `${fingerprint}:${data.backend}:${data.backendToken}`;
    useEffect(() => {
        setReady(0);

        callbacks.current.reset();
        provider.current?.dispose();
        if (!storageReady || !active || !data.backend) {
            setBusy(false);
            return;
        }
        const abort = new AbortController();
        const snapshot = { ...active };
        const client = createProvider(
            snapshot,
            new ProviderTransport(data.backend, data.backendToken),
            (source) =>
                callbacks.current.update((d) => ({
                    ...d,
                    sources: d.sources.map((s) =>
                        s.id === source.id && !abort.signal.aborted
                            ? {
                                  ...s,
                                  endpoint: source.endpoint,
                                  full: source.full,
                                  token: source.token,
                              }
                            : s
                    ),
                }))
        );
        owner.current = connectionKey;
        provider.current = client;
        setBusy(true);
        callbacks.current.report('');
        client
            .connect(abort.signal)
            .then(() => {
                if (!abort.signal.aborted) {
                    callbacks.current.report('');
                    setReady(retry + 1);
                }
            })
            .catch(() => {
                if (!abort.signal.aborted)
                    callbacks.current.report(
                        'The request failed. Check your source and backend, then retry.'
                    );
            })
            .finally(() => {
                if (!abort.signal.aborted) setBusy(false);
            });
        return () => {
            abort.abort();
            client.dispose();
        };
    }, [
        fingerprint,
        active?.m3uItems,
        data.backend,
        data.backendToken,
        storageReady,
        retry,
    ]);
    return {
        provider,
        ready: owner.current === connectionKey ? ready : 0,
        busy,
        connectionKey,
        enabled: storageReady && !!active && !!data.backend,
    };
}
