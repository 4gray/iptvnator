import { BackendConnection } from './backend-connection';
import { PhoneSetup } from './phone-setup';
import { normalizeStalkerMacAddress } from '@iptvnator/shared/interfaces';
import { useState } from 'preact/hooks';
import {
    httpUrl,
    removeSourceData,
    Source,
    Provider,
} from '@iptvnator/tv/util';
import { TvModel } from './use-tv';
export function Sources({ tv }: { tv: TvModel }) {
    const [type, setType] = useState<Provider>('xtream');
    const [editing, setEditing] = useState<Source>();
    const [failure, setFailure] = useState('');
    const [saving, setSaving] = useState(false);
    function edit(source: Source) {
        setEditing(source);
        setType(source.provider);
    }
    async function submit(event: SubmitEvent) {
        event.preventDefault();
        setFailure('');
        const values = new FormData(event.currentTarget as HTMLFormElement);
        const rawField = (key: string) => String(values.get(key) ?? '');
        const field = (key: string) => rawField(key).trim();
        const enteredMac = String(values.get('macAddress') ?? '');
        try {
            const source: Source = {
                id:
                    editing?.id ??
                    `tv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: field('name'),
                provider: type,
                url: httpUrl(field('url')),
                ...(type !== 'm3u'
                    ? {
                          username: field('username'),
                          password:
                              type === 'stalker'
                                  ? String(values.get('password') ?? '')
                                  : field('password'),
                      }
                    : {}),
                ...(type === 'stalker'
                    ? {
                          macAddress:
                              editing && enteredMac === editing.macAddress
                                  ? editing.macAddress
                                  : (normalizeStalkerMacAddress(enteredMac) ??
                                    field('macAddress')),
                          serialNumber: rawField('serialNumber'),
                          deviceId1: rawField('deviceId1'),
                          deviceId2: rawField('deviceId2'),
                          signature1: rawField('signature1'),
                          signature2: rawField('signature2'),
                      }
                    : {}),
            };
            setSaving(true);
            await tv.saveSource(source, httpUrl(field('backend')));
        } catch {
            setFailure(
                'Check the URL fields. Use HTTP or HTTPS addresses without embedded login credentials.'
            );
        } finally {
            setSaving(false);
        }
    }
    return (
        <>
            <p class="muted">
                Your subscriptions. Server sources are managed in the PWA.
            </p>
            <div class="source-list">
                {tv.data.sources.map((source) => (
                    <div class="source-row" key={source.id}>
                        <button
                            onClick={() => {
                                void tv.switchSource(source.id);
                            }}
                        >
                            {tv.data.activeId === source.id ? '● ' : ''}
                            {source.name}
                        </button>
                        <button
                            disabled={!!source.libraryId || !!source.m3uItems}
                            onClick={() => edit(source)}
                        >
                            {source.libraryId
                                ? 'Server source'
                                : source.m3uItems
                                  ? 'Stored playlist'
                                  : 'Edit'}
                        </button>
                        <button
                            disabled={!!source.libraryId}
                            onClick={() => {
                                if (
                                    confirm(
                                        `Remove ${source.name} and its local viewing data?`
                                    )
                                )
                                    tv.update((d) =>
                                        removeSourceData(d, source.id)
                                    ).catch(() =>
                                        tv.setError('Source was not removed.')
                                    );
                            }}
                        >
                            Remove
                        </button>
                    </div>
                ))}
            </div>
            <PhoneSetup tv={tv} />
            <div class="filters">
                {(['xtream', 'stalker', 'm3u'] as Provider[]).map((p) => (
                    <button
                        aria-pressed={type === p}
                        onClick={() => {
                            setType(p);
                            setEditing(undefined);
                        }}
                    >
                        {p.toUpperCase()}
                    </button>
                ))}
            </div>
            <form
                class="source-form"
                onSubmit={submit}
                key={`${type}:${editing?.id ?? 'new'}`}
            >
                <h2>{editing ? 'Edit source' : 'Add a source'}</h2>
                <BackendConnection tv={tv} />
                <label>
                    Name
                    <input name="name" required defaultValue={editing?.name} />
                </label>
                <label>
                    {type === 'm3u' ? 'Playlist URL' : 'Provider URL'}
                    <input
                        name="url"
                        type="url"
                        required
                        defaultValue={editing?.url}
                        placeholder="https://provider.example"
                    />
                </label>
                {type !== 'm3u' ? (
                    <>
                        <label>
                            Username{type === 'stalker' ? ' (if required)' : ''}
                            <input
                                name="username"
                                required={type === 'xtream'}
                                defaultValue={editing?.username}
                                autoComplete="off"
                            />
                        </label>
                        <label>
                            Password
                            <input
                                name="password"
                                type="password"
                                required={type === 'xtream'}
                                defaultValue={editing?.password}
                                autoComplete="off"
                            />
                        </label>
                    </>
                ) : null}
                {type === 'stalker' ? (
                    <>
                        <label>
                            MAC address
                            <input
                                name="macAddress"
                                required
                                defaultValue={editing?.macAddress}
                                placeholder="00:1A:79:00:00:01"
                            />
                        </label>
                        <details>
                            <summary>Existing MAG device identity</summary>
                            <p class="muted">
                                Enter identity values supplied for your account.
                                Values are sent exactly as entered; IDs are
                                never generated automatically.
                            </p>
                            {[
                                ['serialNumber', 'Serial number'],
                                ['deviceId1', 'Device ID'],
                                ['deviceId2', 'Device ID 2'],
                                ['signature1', 'Signature'],
                                ['signature2', 'Signature 2'],
                            ].map(([key, label]) => (
                                <label>
                                    {label}
                                    <input
                                        name={key}
                                        defaultValue={
                                            editing?.[
                                                key as keyof Source
                                            ] as string
                                        }
                                    />
                                </label>
                            ))}
                        </details>
                    </>
                ) : null}
                {failure ? <p role="alert">{failure}</p> : null}
                <button class="primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save and connect'}
                </button>
            </form>
        </>
    );
}
