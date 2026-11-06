import { useEffect, useRef, useState } from 'preact/hooks';

export const RECONNECT_DELAYS = [2000, 5000, 10000, 30000];

/** Bounded retries only in the foreground and outside a playback session. */
export function useReconnect(options: {
    key: string;
    enabled: boolean;
    failed: boolean;
    busy: boolean;
    playing: boolean;
    ready: number;
    retry: () => void;
}) {
    const latest = useRef(options);
    latest.current = options;
    const attempts = useRef(0);
    const [wake, setWake] = useState(0);
    const [status, setStatus] = useState('');
    useEffect(() => {
        attempts.current = 0;
    }, [options.key]);
    useEffect(() => {
        if (!options.ready || options.failed || options.busy) return;
        const timer = setTimeout(() => {
            attempts.current = 0;
        }, 60000);
        return () => clearTimeout(timer);
    }, [options.ready, options.failed, options.busy]);
    useEffect(() => {
        const resume = () => {
            if (document.hidden || navigator.onLine === false) {
                setWake((n) => n + 1);
                return;
            }
            const current = latest.current;
            attempts.current = 0;
            setWake((n) => n + 1);
            if (current.enabled && !current.busy && !current.playing)
                current.retry();
        };
        window.addEventListener('online', resume);
        window.addEventListener('offline', resume);
        document.addEventListener('visibilitychange', resume);
        return () => {
            window.removeEventListener('online', resume);
            window.removeEventListener('offline', resume);
            document.removeEventListener('visibilitychange', resume);
        };
    }, []);
    useEffect(() => {
        if (
            !options.enabled ||
            !options.failed ||
            options.busy ||
            options.playing
        ) {
            setStatus('');
            return;
        }
        if (document.hidden || navigator.onLine === false) {
            setStatus('Waiting for the TV network.');
            return;
        }
        const delay = RECONNECT_DELAYS[attempts.current];
        if (delay === undefined) {
            setStatus(
                'Automatic retries stopped. Check your server or source, then retry.'
            );
            return;
        }
        setStatus(
            `Reconnecting in ${delay / 1000} seconds (${attempts.current + 1}/${RECONNECT_DELAYS.length})…`
        );
        const timer = setTimeout(() => {
            const current = latest.current;
            if (
                document.hidden ||
                navigator.onLine === false ||
                current.playing ||
                current.busy
            )
                return;
            attempts.current++;
            current.retry();
        }, delay);
        return () => clearTimeout(timer);
    }, [
        options.enabled,
        options.failed,
        options.busy,
        options.playing,
        options.key,
        wake,
    ]);
    return {
        reconnectStatus: status,
        resetReconnect: () => {
            attempts.current = 0;
            setWake((n) => n + 1);
        },
    };
}
