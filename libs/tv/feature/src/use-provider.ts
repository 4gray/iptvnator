import { useEffect, useRef, useState } from 'preact/hooks';
import { createProvider, ProviderTransport } from '@iptvnator/tv/data-access';
import type { ProviderClient, Source, UserData } from '@iptvnator/tv/util';

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
    const [result, setResult] = useState<{
        key: string;
        retry: number;
        items: Source['m3uItems'];
        status: 'ready' | 'failed';
    }>();
    const [busy, setBusy] = useState(false);
    const provider = useRef<ProviderClient>();
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
    const enabled = storageReady && !!active && !!data.backend;
    const status =
        enabled &&
        result?.key === connectionKey &&
        result.retry === retry &&
        result.items === active?.m3uItems
            ? result.status
            : undefined;
    useEffect(() => {
        setResult(undefined);

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
        provider.current = client;
        setBusy(true);
        callbacks.current.report('');
        const attempt = { key: connectionKey, retry, items: active.m3uItems };
        client
            .connect(abort.signal)
            .then(() => {
                if (!abort.signal.aborted) {
                    callbacks.current.report('');
                    setResult({ ...attempt, status: 'ready' });
                }
            })
            .catch(() => {
                if (!abort.signal.aborted) {
                    setResult({ ...attempt, status: 'failed' });
                    callbacks.current.report(
                        'The request failed. Check your source and backend, then retry.'
                    );
                }
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
        ready: status === 'ready' ? retry + 1 : 0,
        providerFailed: status === 'failed',
        busy,
        connectionKey,
        enabled,
    };
}
