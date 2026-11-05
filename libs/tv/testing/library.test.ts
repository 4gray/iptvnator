import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialData, type Source } from '@iptvnator/tv/util';
import {
    librarySource,
    sourceDocument,
    mergeLibrary,
    disconnectLibrary,
    ServerLibrary,
    createProvider,
    ProviderTransport,
} from '@iptvnator/tv/data-access';
import type { Playlist } from '@iptvnator/shared/interfaces';
const doc = (fields: Partial<Playlist> = {}): Playlist => ({
    _id: 'server-1',
    title: 'Library',
    importDate: '',
    lastUsage: '',
    autoRefresh: false,
    count: 0,
    serverUrl: 'https://panel.test',
    username: 'user',
    password: 'secret',
    ...fields,
});
const settings = {
    url: 'https://library.test/api',
    token: 'key',
    instanceId: 'instance-1',
    originals: {},
    lastSync: 0,
};

test('server source mapping preserves MAG identity bytes and full/simple mode, never shared session tokens', () => {
    for (const full of [true, false]) {
        const remote = doc({
            serverUrl: undefined,
            portalUrl: 'https://portal.test/server/load.php',
            macAddress: '00:1a:79:00:00:03',
            password: ' pass ',
            isFullStalkerPortal: full,
            stalkerSerialNumber: ' serial ',
            stalkerDeviceId1: ' device1 ',
            stalkerDeviceId2: 'device2',
            stalkerSignature1: 'sig1',
            stalkerSignature2: 'sig2',
            stalkerToken: 'another-device-token',
        });
        const source = librarySource(remote, settings.instanceId);
        assert.equal(source.provider, 'stalker');
        assert.equal(source.password, ' pass ');
        assert.equal(source.serialNumber, ' serial ');
        assert.equal(source.deviceId1, ' device1 ');
        assert.equal(source.full, full);
        assert.equal(source.token, undefined);
        const roundTrip = sourceDocument(source);
        for (const field of [
            'password',
            'stalkerSerialNumber',
            'stalkerDeviceId1',
            'stalkerDeviceId2',
            'stalkerSignature1',
            'stalkerSignature2',
            'isFullStalkerPortal',
        ] as const)
            assert.equal(roundTrip[field], remote[field]);
        assert.equal(roundTrip.stalkerToken, undefined);
    }
});
test('library links preserve TV media identity, originals, local-only sources and deletion recovery', () => {
    const local: Source = {
        id: 'tv-existing',
        name: 'Local',
        provider: 'xtream',
        url: 'https://panel.test/',
        username: 'user',
        password: 'older',
    };
    const independent = { ...local, id: 'other', username: 'other' };
    const data = {
        ...initialData(),
        sources: [local, independent],
        activeId: local.id,
    };
    const linked = mergeLibrary(data, settings, [
        librarySource(doc(), settings.instanceId),
    ]);
    assert.equal(linked.sources[0].id, local.id);
    assert.equal(linked.activeId, local.id);
    assert.equal(linked.sources[0].password, 'secret');
    assert.equal(linked.sources.length, 2);
    assert.deepEqual(linked.library?.originals[local.id], local);
    assert.deepEqual(disconnectLibrary(linked).sources, [local, independent]);
    const removed = mergeLibrary(linked, linked.library!, []);
    assert.deepEqual(removed.sources, [local, independent]);
    const newData = mergeLibrary(initialData(), settings, [
        librarySource(doc(), settings.instanceId),
    ]);
    const detached = disconnectLibrary(newData);
    assert.equal(detached.sources[0].libraryId, undefined);
    assert.equal(detached.sources[0].id, newData.sources[0].id);
});
test('matching Stalker session stays local, changed credentials discard it', () => {
    const remote = librarySource(
        doc({
            serverUrl: undefined,
            portalUrl: 'https://portal.test/server/load.php',
            macAddress: '00:1a:79:00:00:03',
        }),
        'instance-1'
    );
    const cached = {
        ...remote,
        full: true,
        endpoint: remote.url,
        token: 'tv-token',
    };
    const data = { ...initialData(), sources: [cached], library: settings };
    assert.equal(
        mergeLibrary(data, settings, [remote]).sources[0].token,
        'tv-token'
    );
    assert.equal(
        mergeLibrary(data, settings, [{ ...remote, password: 'changed' }])
            .sources[0].token,
        undefined
    );
});
test('stored file M3U plays through the ordinary adapter without a parse request', async () => {
    const source = librarySource(
        doc({
            serverUrl: undefined,
            playlist: {
                items: [
                    {
                        name: 'News',
                        url: 'https://media.test/live.ts',
                        group: { title: 'TV' },
                    },
                ],
            },
        }),
        'instance-1'
    );
    const provider = createProvider(
        source,
        {
            request: () => {
                throw new Error('must not fetch');
            },
        } as unknown as ProviderTransport,
        async () => undefined
    );
    await provider.connect(new AbortController().signal);
    const catalog = await provider.catalog(
        'live',
        '',
        0,
        '',
        new AbortController().signal
    );
    assert.equal(catalog.items[0].title, 'News');
    assert.equal(
        (await provider.resolve(catalog.items[0], new AbortController().signal))
            .url,
        'https://media.test/live.ts'
    );
});
test('library verifies instance without credentials and refuses token/write to a replaced instance', async () => {
    const original = globalThis.fetch;
    const calls: RequestInit[] = [];
    globalThis.fetch = async (_url, init = {}) => {
        calls.push(init);
        return Response.json({
            service: 'iptvnator',
            apiVersion: 1,
            storage: 'server',
            auth: 'token',
            instanceId: 'replacement',
        });
    };
    try {
        await assert.rejects(
            new ServerLibrary(settings.url, 'private-token', 'instance-1').read(
                new AbortController().signal
            ),
            /changed/
        );
        assert.equal(calls.length, 1);
        assert.equal(new Headers(calls[0].headers).has('Authorization'), false);
        assert.equal(calls[0].redirect, 'error');
    } finally {
        globalThis.fetch = original;
    }
});
test('upload skips existing provider account and uses create-only stable IDs for new sources', async () => {
    const original = globalThis.fetch;
    const writes: { url: string; init: RequestInit }[] = [];
    let documents = [doc()];
    globalThis.fetch = async (input, init = {}) => {
        const url = String(input);
        if (url.endsWith('/instance'))
            return Response.json({
                service: 'iptvnator',
                apiVersion: 1,
                storage: 'server',
                auth: 'token',
                instanceId: 'instance-1',
            });
        assert.equal(
            new Headers(init.headers).get('Authorization'),
            'Bearer key'
        );
        if (init.method === 'PUT') {
            writes.push({ url, init });
            documents.push(JSON.parse(String(init.body)));
            return Response.json({ success: true });
        }
        return Response.json(documents);
    };
    try {
        const client = new ServerLibrary(
            settings.url,
            settings.token,
            settings.instanceId
        );
        const source = {
            ...librarySource(doc(), 'instance-1'),
            id: 'tv-local',
            libraryId: undefined,
        };
        await client.upload(source, new AbortController().signal);
        assert.equal(writes.length, 0);
        documents = [];
        await client.upload(source, new AbortController().signal);
        await client.upload(source, new AbortController().signal);
        assert.equal(writes.length, 1);
        assert.equal(
            new Headers(writes[0].init.headers).get('If-None-Match'),
            '*'
        );
        assert.ok(writes[0].url.endsWith('/playlists/tv-local'));
        assert.equal(
            JSON.parse(String(writes[0].init.body)).favorites,
            undefined
        );
    } finally {
        globalThis.fetch = original;
    }
});

test('upload refuses an unrelated colliding server ID without issuing a write', async () => {
    const original = globalThis.fetch;
    let writes = 0;
    globalThis.fetch = async (input, init = {}) => {
        if (init.method === 'PUT') writes++;
        return Response.json(
            String(input).endsWith('/instance')
                ? {
                      service: 'iptvnator',
                      apiVersion: 1,
                      storage: 'server',
                      auth: 'none',
                      instanceId: 'instance-1',
                  }
                : [doc({ _id: 'local-id', username: 'different-account' })]
        );
    };
    try {
        await assert.rejects(
            new ServerLibrary(settings.url, '').upload(
                { ...librarySource(doc(), 'instance-1'), id: 'local-id' },
                new AbortController().signal
            ),
            /different server source/
        );
        assert.equal(writes, 0);
    } finally {
        globalThis.fetch = original;
    }
});
