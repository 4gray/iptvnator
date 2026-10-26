import { useEffect, useRef, useState } from 'preact/hooks';
import {
    BackendInfo,
    backendUrl,
    checkBackend,
    discoverBackends,
} from '@iptvnator/tv/data-access';
import { LatestRequest, UserData } from '@iptvnator/tv/util';
export function useBackend(
    data: UserData,
    ready: boolean,
    update: (change: (data: UserData) => UserData) => Promise<void>
) {
    const [url, setUrl] = useState('');
    const [token, setToken] = useState('');
    const [status, setStatus] = useState('Not connected');
    const [connected, setConnected] = useState(false);
    const [searching, setSearching] = useState(false);
    const [found, setFound] = useState<BackendInfo[]>([]);
    const lane = useRef(new LatestRequest());
    const initialized = useRef(false);
    const latest = useRef({ data, update });
    latest.current = { data, update };
    function editUrl(value: string) {
        lane.current.cancel();
        setSearching(false);
        setConnected(false);
        setStatus('Not checked');
        setUrl(value);
        if (value.replace(/\/$/, '') !== data.backend.replace(/\/$/, ''))
            setToken('');
    }
    function editToken(value: string) {
        lane.current.cancel();
        setSearching(false);
        setConnected(false);
        setStatus('Not checked');
        setToken(value);
    }
    async function connect(value = url, secret = token, persist = true) {
        const job = lane.current.start();
        setSearching(false);
        setConnected(false);
        setStatus('Checking backend…');
        try {
            const info = await checkBackend(value, secret, job.signal);
            if (!lane.current.owns(job)) return false;
            if (persist)
                await latest.current.update((d) => ({
                    ...d,
                    backend: info.url,
                    backendToken: secret,
                }));
            if (!lane.current.owns(job)) return false;
            setUrl(info.url);
            setToken(secret);
            setStatus('Connected');
            setConnected(true);
            setFound([]);
            return true;
        } catch (error) {
            if (lane.current.owns(job))
                setStatus(
                    error instanceof Error
                        ? error.message
                        : 'Backend is unavailable.'
                );
            return false;
        }
    }
    async function find() {
        const job = lane.current.start();
        setSearching(true);
        setConnected(false);
        setFound([]);
        setStatus('Looking for IPTVnator in your local network…');
        const matches: BackendInfo[] = [];
        await discoverBackends(job.signal, (info) => {
            if (
                lane.current.owns(job) &&
                !matches.some((x) => x.url === info.url)
            ) {
                matches.push(info);
                setFound([...matches]);
            }
        });
        if (!lane.current.owns(job)) return;
        setSearching(false);
        if (matches.length === 1 && matches[0].auth === 'none') {
            setUrl(matches[0].url);
            setToken('');
            await connect(matches[0].url, '');
        } else
            setStatus(
                matches.length
                    ? 'Choose your backend below.'
                    : 'No backend found. Enter its address manually.'
            );
    }
    function cancel() {
        lane.current.cancel();
        setSearching(false);
        setStatus('Search cancelled. Enter an address or search again.');
    }
    useEffect(() => {
        if (!ready || initialized.current) return;
        initialized.current = true;
        setUrl(data.backend);
        setToken(data.backendToken);
        if (data.backend) void connect(data.backend, data.backendToken, false);
        else void find();
    }, [ready]);
    useEffect(() => () => lane.current.cancel(), []);
    useEffect(() => {
        if (!ready || !data.backend) return;
        const check = () => {
            if (
                document.hidden ||
                searching ||
                url !== data.backend ||
                token !== data.backendToken
            )
                return;
            void connect(data.backend, data.backendToken, false);
        };
        const timer = setInterval(check, 30_000);
        return () => clearInterval(timer);
    }, [ready, data.backend, data.backendToken, url, token, searching]);
    return {
        url,
        token,
        status,
        searching,
        found,
        editUrl,
        editToken,
        connect,
        find,
        cancel,
        connected:
            connected && url === data.backend && token === data.backendToken,
        choose: (info: BackendInfo) => {
            lane.current.cancel();
            setSearching(false);
            setUrl(info.url);
            setToken('');
            setFound([]);
            if (info.auth === 'token') {
                setConnected(false);
                setStatus('Enter this backend’s access token, then connect.');
            } else void connect(info.url, '');
        },
        normalized: () => backendUrl(url),
    };
}
