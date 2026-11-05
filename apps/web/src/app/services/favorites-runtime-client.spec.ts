import { signal } from '@angular/core';
import { of } from 'rxjs';
import type {
    Playlist,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import type { RuntimeCapabilitiesService } from '@iptvnator/services';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import {
    FavoriteSupersededError,
    retireFavoriteSourceContext,
    observeFavoriteSourceRetirement,
} from '@iptvnator/services/favorites-sync';
import { createFavoritesRuntimeClient } from './favorites-runtime-client';
import { FavoritesSyncRuntime } from './favorites-sync-runtime';

afterEach(async () => {
    jest.restoreAllMocks();
    localStorage.clear();
    await prepareSourceConnection();
});

it('keeps a reverified same-incarnation context across a delayed notice and offline restart', async () => {
    const instanceId = 'synthetic-same-instance';
    const source = {
        sourceId: 'synthetic-source',
        sourceIncarnation: 'same',
        provider: 'xtream' as const,
    };
    localStorage.setItem(
        'iptvnator:source-server',
        JSON.stringify({ apiUrl: 'https://synthetic.test/api', instanceId })
    );
    await prepareSourceConnection();
    const key = `iptvnator-server:${instanceId}:favorites-contexts-v1`;
    const consentKey = `iptvnator-server:${instanceId}:favorites-consent-v1`;
    const consent = {
        enabled: true,
        generation: 'g',
        deviceId: 'synthetic-device',
    };
    localStorage.setItem(consentKey, JSON.stringify(consent));
    localStorage.setItem(key, JSON.stringify([source]));
    retireFavoriteSourceContext(instanceId, source.sourceId);
    const notice = localStorage.getItem(`${key}:retired`)!;
    const capabilities = {
        isElectron: true,
        supportsFavoritesStorage: true,
        supportsXtreamSqliteDataSource: true,
    } as RuntimeCapabilitiesService;
    const locks = {
        active: () => false,
        withholdsEverything: () => false,
        version: () => 0,
    };
    const create = () =>
        createFavoritesRuntimeClient(
            capabilities,
            async () => ({ _id: source.sourceId }) as Playlist,
            jest.fn(),
            locks
        ).client;
    const verified = create();
    jest.spyOn(verified.options, 'request').mockResolvedValue({
        status: 200,
        body: source,
    });
    await verified.context(source.sourceId);
    retireFavoriteSourceContext(instanceId, 'synthetic-other');
    const renewed = create();
    jest.spyOn(renewed.options, 'request').mockResolvedValue({
        status: 200,
        body: {
            ...source,
            sourceId: 'synthetic-other',
            sourceIncarnation: 'other',
        },
    });
    await renewed.context('synthetic-other');
    const stop = observeFavoriteSourceRetirement(() => renewed);
    try {
        window.dispatchEvent(
            new StorageEvent('storage', {
                key: `${key}:retired`,
                newValue: notice,
            })
        );
        expect(renewed.contexts.get(source.sourceId)).toEqual(source);
        localStorage.setItem(
            consentKey,
            JSON.stringify({ ...consent, enabled: false })
        );
        expect(create().contexts.get(source.sourceId)).toEqual(source);
    } finally {
        stop();
    }
});

it('rejects context responses started before retirement and renews the runtime before disabled local edits', async () => {
    const instanceId = 'synthetic-instance';
    localStorage.setItem(
        'iptvnator:source-server',
        JSON.stringify({ apiUrl: 'https://synthetic.test/api', instanceId })
    );
    await prepareSourceConnection();
    const consentKey = `iptvnator-server:${instanceId}:favorites-consent-v1`;
    const consent = {
        enabled: true,
        generation: 'g',
        deviceId: 'synthetic-device',
    };
    localStorage.setItem(consentKey, JSON.stringify(consent));
    localStorage.setItem(
        `iptvnator-server:${instanceId}:favorites-contexts-v1`,
        JSON.stringify([
            {
                sourceId: 'synthetic-source',
                sourceIncarnation: 'old',
                provider: 'xtream',
            },
        ])
    );
    const capabilities = {
        isElectron: true,
        supportsFavoritesStorage: true,
        supportsXtreamSqliteDataSource: true,
    } as RuntimeCapabilitiesService;
    const locks = {
        active: () => false,
        withholdsEverything: () => false,
        version: () => 0,
    };
    const playlist = { _id: 'synthetic-source' } as Playlist;
    const { client } = createFavoritesRuntimeClient(
        capabilities,
        async () => playlist,
        jest.fn(),
        locks
    );
    let finish!: (response: SourceServerResponse) => void;
    const response = new Promise<SourceServerResponse>(
        (resolve) => (finish = resolve)
    );
    jest.spyOn(client.options, 'request').mockImplementation(() => response);
    const pending = client.context(playlist._id);
    retireFavoriteSourceContext(instanceId, playlist._id);
    finish({
        status: 200,
        body: {
            sourceId: playlist._id,
            sourceIncarnation: 'old',
            provider: 'xtream',
        },
    });
    await expect(pending).rejects.toBeInstanceOf(FavoriteSupersededError);
    expect(client.options.profileActive?.()).toBe(false);
    expect(() =>
        client.options.remember([
            {
                sourceId: playlist._id,
                sourceIncarnation: 'old',
                provider: 'xtream',
            },
        ])
    ).toThrow('Favorite profile changed');
    expect(
        JSON.parse(
            localStorage.getItem(
                `iptvnator-server:${instanceId}:favorites-contexts-v1`
            )!
        )
    ).toEqual([]);
    localStorage.setItem(
        consentKey,
        JSON.stringify({ ...consent, enabled: false })
    );
    const runtime = Object.create(
        FavoritesSyncRuntime.prototype
    ) as FavoritesSyncRuntime;
    Object.assign(runtime, {
        client,
        capabilities,
        locks,
        sourceNames: new Map(),
        error: signal(false),
        playlists: { getPlaylistById: () => of(playlist) },
    });
    expect(
        await runtime.invoke({} as never, 'supportsPortableFavorites', [
            playlist._id,
        ])
    ).toBe(false);
});
