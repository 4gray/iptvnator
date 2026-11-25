import { EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';
import {
    DEFAULT_PROFILE_ID,
    PROFILES_CAPABILITY,
    type ServerProfile,
} from '@iptvnator/shared/interfaces/profiles';
import {
    activeProfileKey,
    readActiveProfileId,
    writeActiveProfileId,
} from './profiles-preferences';
import { PROFILES_REQUEST } from './profiles-request.token';
import { PROFILES_POLL_MS, ProfilesRuntime } from './profiles-runtime';
import { loadProfilesRuntime } from './profiles-runtime.providers';
import {
    PROFILES_UI_ENABLED,
    PROFILES_UI_ENABLED_TOKEN,
} from './profiles-ui-enabled';

const NAS = 'synthetic-nas';
const ADULT = '11111111-1111-4111-8111-111111111111';
const STALE = '33333333-3333-4333-8333-333333333333';

function profile(id: string, sortOrder: number): ServerProfile {
    return {
        id,
        scope: id === DEFAULT_PROFILE_ID ? 'shared' : `profile:${id}`,
        name: `Synthetic ${sortOrder}`,
        colour: '#336699',
        hasPin: false,
        kids: false,
        sortOrder,
    };
}

/** A synthetic server: `/v1/instance` and `GET /v1/profiles` with ETags. */
function fakeServer() {
    const server = {
        instanceId: NAS,
        capabilities: ['sources-v1', PROFILES_CAPABILITY],
        enabled: true,
        revision: 1,
        profiles: [profile(DEFAULT_PROFILE_ID, 0), profile(ADULT, 1)],
        offline: false,
        listStatus: 200,
    };
    const request = jest.fn(
        async (input: SourceServerRequest): Promise<SourceServerResponse> => {
            if (server.offline) throw new Error('SOURCE_SYNC.OFFLINE');
            if (input.operation === 'instance')
                return {
                    status: 200,
                    body: {
                        service: 'iptvnator',
                        apiVersion: 1,
                        storage: 'server',
                        instanceId: server.instanceId,
                        capabilities: server.capabilities,
                    },
                };
            if (input.operation !== 'profiles-list')
                throw new Error('Unexpected synthetic request');
            if (server.listStatus !== 200)
                return { status: server.listStatus, body: { code: 'x' } };
            if (input.revision === String(server.revision))
                return { status: 304 };
            return {
                status: 200,
                body: {
                    enabled: server.enabled,
                    revision: server.revision,
                    profiles: server.profiles,
                },
            };
        }
    );
    const calls = (operation: SourceServerRequest['operation']) =>
        request.mock.calls.filter(([input]) => input.operation === operation);
    return { server, request, calls };
}

async function connect(instanceId = NAS): Promise<void> {
    localStorage.setItem(
        'iptvnator:source-server',
        JSON.stringify({ apiUrl: 'https://nas.example/api', instanceId })
    );
    await prepareSourceConnection();
}

describe('ProfilesRuntime', () => {
    const originalElectron = window.electron;
    let fake: ReturnType<typeof fakeServer>;

    async function start(uiEnabled?: boolean): Promise<ProfilesRuntime> {
        TestBed.configureTestingModule({
            providers: [
                { provide: PROFILES_REQUEST, useValue: fake.request },
                ...(uiEnabled === undefined
                    ? []
                    : [
                          {
                              provide: PROFILES_UI_ENABLED_TOKEN,
                              useValue: uiEnabled,
                          },
                      ]),
            ],
        });
        const runtime = TestBed.inject(ProfilesRuntime);
        // Let the constructor's queued refresh start, then join it.
        await Promise.resolve();
        await runtime.refresh();
        return runtime;
    }

    beforeEach(async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
        Reflect.deleteProperty(window, 'electron');
        localStorage.clear();
        fake = fakeServer();
        await connect();
    });

    afterEach(async () => {
        TestBed.resetTestingModule();
        jest.clearAllTimers();
        jest.useRealTimers();
        Reflect.deleteProperty(document, 'hidden');
        localStorage.clear();
        await prepareSourceConnection();
        window.electron = originalElectron;
    });

    it('keeps the UI hidden by default and lets tests flip the token', async () => {
        expect(PROFILES_UI_ENABLED).toBe(false);
        expect((await start()).uiEnabled).toBe(false);
        TestBed.resetTestingModule();
        expect((await start(true)).uiEnabled).toBe(true);
    });

    it('lazy-loads the root runtime', async () => {
        const runtime = await start();
        await expect(
            loadProfilesRuntime(TestBed.inject(EnvironmentInjector))
        ).resolves.toBe(runtime);
    });

    it('loads the list from a capable server with Default active', async () => {
        const runtime = await start();
        expect(runtime.capable()).toBe(true);
        expect(runtime.state()).toBe('ready');
        expect(runtime.enabled()).toBe(true);
        expect(runtime.list()?.profiles.map((p) => p.id)).toEqual([
            DEFAULT_PROFILE_ID,
            ADULT,
        ]);
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(runtime.active()?.id).toBe(DEFAULT_PROFILE_ID);
    });

    it('stays off a server without the capability and never lists', async () => {
        fake.server.capabilities = ['sources-v1'];
        const runtime = await start();
        expect(runtime.capable()).toBe(false);
        expect(runtime.state()).toBe('unsupported');
        expect(fake.calls('profiles-list')).toHaveLength(0);
        await runtime.refresh();
        expect(fake.calls('instance')).toHaveLength(1);
    });

    it('does not trust a probe answered by another instance', async () => {
        fake.server.instanceId = 'synthetic-replacement';
        const runtime = await start();
        expect(runtime.capable()).toBe(false);
        expect(runtime.state()).toBe('offline');
        expect(fake.calls('profiles-list')).toHaveLength(0);
        fake.server.instanceId = NAS;
        await runtime.refresh();
        expect(runtime.capable()).toBe(true);
    });

    it('revalidates with the last revision and keeps the list on 304', async () => {
        const runtime = await start();
        const first = runtime.list();
        await runtime.refresh();
        expect(fake.calls('profiles-list').at(-1)?.[0].revision).toBe('1');
        expect(runtime.list()).toBe(first);
        fake.server.revision = 2;
        fake.server.profiles = [profile(DEFAULT_PROFILE_ID, 0)];
        await runtime.refresh();
        expect(runtime.list()?.revision).toBe(2);
        expect(runtime.list()?.profiles).toHaveLength(1);
    });

    it('restores the stored active profile', async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        expect(runtime.activeId()).toBe(ADULT);
        expect(runtime.active()?.id).toBe(ADULT);
    });

    it('names the personal scope of the active profile only while the UI is on', async () => {
        writeActiveProfileId(NAS, ADULT);
        const hidden = await start();
        expect(hidden.activeId()).toBe(ADULT);
        expect(hidden.scope()).toBe('shared');
        TestBed.resetTestingModule();
        const visible = await start(true);
        expect(visible.scope()).toBe(`profile:${ADULT}`);
        expect(visible.select(DEFAULT_PROFILE_ID)).toBe(true);
        expect(visible.scope()).toBe('shared');
    });

    it('falls back to Default and forgets a stale stored profile', async () => {
        writeActiveProfileId(NAS, STALE);
        const runtime = await start();
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(readActiveProfileId(NAS)).toBeNull();
    });

    it('shows Default while profiles are off but keeps the stored id', async () => {
        writeActiveProfileId(NAS, ADULT);
        fake.server.enabled = false;
        const runtime = await start();
        expect(runtime.enabled()).toBe(false);
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(readActiveProfileId(NAS)).toBe(ADULT);
        fake.server.enabled = true;
        fake.server.revision = 2;
        await runtime.refresh();
        expect(runtime.activeId()).toBe(ADULT);
    });

    it('selects only a listed profile while profiles are on', async () => {
        const runtime = await start();
        expect(runtime.select(STALE)).toBe(false);
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(runtime.select(ADULT)).toBe(true);
        expect(runtime.activeId()).toBe(ADULT);
        expect(readActiveProfileId(NAS)).toBe(ADULT);
    });

    it('selects only Default while profiles are off', async () => {
        fake.server.enabled = false;
        const runtime = await start();
        expect(runtime.select(ADULT)).toBe(false);
        expect(runtime.select(DEFAULT_PROFILE_ID)).toBe(true);
        expect(readActiveProfileId(NAS)).toBe(DEFAULT_PROFILE_ID);
    });

    it('selects nothing before a list has loaded', async () => {
        fake.server.offline = true;
        const runtime = await start();
        expect(runtime.select(DEFAULT_PROFILE_ID)).toBe(false);
    });

    it('falls back to Default when a profile goes missing', async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        fake.server.revision = 2;
        fake.server.profiles = [profile(DEFAULT_PROFILE_ID, 0)];
        runtime.handleProfileError('profile_missing');
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(readActiveProfileId(NAS)).toBeNull();
        await runtime.refresh();
        expect(runtime.list()?.profiles).toHaveLength(1);
    });

    it('ignores a poll asked before a deletion and does not restore the profile', async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        expect(runtime.activeId()).toBe(ADULT);
        const original = fake.request.getMockImplementation()!;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        fake.server.revision = 2;
        fake.request.mockImplementationOnce(async (input) => {
            const stale = await original(input);
            await gate;
            return stale;
        });
        const poll = runtime.refresh();
        await jest.advanceTimersByTimeAsync(0);
        fake.server.revision = 3;
        fake.server.profiles = [profile(DEFAULT_PROFILE_ID, 0)];
        runtime.handleProfileError('profile_missing', ADULT);
        release();
        await poll;
        expect(runtime.list()?.profiles).toHaveLength(1);
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
    });

    it("keeps this device's choice when another profile goes missing", async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        runtime.handleProfileError('profile_missing', STALE);
        expect(runtime.activeId()).toBe(ADULT);
        expect(readActiveProfileId(NAS)).toBe(ADULT);
        runtime.handleProfileError('profile_missing', ADULT);
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(readActiveProfileId(NAS)).toBeNull();
    });

    it('applies a choice for the session when storage is blocked', async () => {
        const runtime = await start();
        const blocked = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('Synthetic blocked storage');
            });
        try {
            expect(runtime.select(ADULT)).toBe(true);
            expect(runtime.activeId()).toBe(ADULT);
        } finally {
            blocked.mockRestore();
        }
    });

    it('keeps a session choice across a refresh when storage is blocked', async () => {
        const runtime = await start();
        const blocked = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('Synthetic blocked storage');
            });
        try {
            runtime.select(ADULT);
            fake.server.revision = 2;
            await runtime.refresh();
            expect(runtime.activeId()).toBe(ADULT);
        } finally {
            blocked.mockRestore();
        }
    });

    it('stays on Default after start-up gave up, and keeps the saved choice', async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        runtime.holdDefault();
        fake.server.revision = 2;
        await runtime.refresh();
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(readActiveProfileId(NAS)).toBe(ADULT);
        runtime.select(ADULT);
        expect(runtime.activeId()).toBe(ADULT);
    });

    it('does not trust an instance answer that fails verification', async () => {
        fake.server.capabilities = [];
        const runtime = await start();
        expect(runtime.capable()).toBe(false);
    });

    it('never restores a saved PIN profile without its PIN', async () => {
        fake.server.profiles = [
            profile(DEFAULT_PROFILE_ID, 0),
            { ...profile(ADULT, 1), hasPin: true },
        ];
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(readActiveProfileId(NAS)).toBe(ADULT);
        runtime.select(ADULT);
        fake.server.revision = 2;
        await runtime.refresh();
        expect(runtime.activeId()).toBe(ADULT);
    });

    it('asks the PIN of a restored profile that gained one after launch', async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        expect(runtime.activeId()).toBe(ADULT);
        fake.server.profiles = [
            profile(DEFAULT_PROFILE_ID, 0),
            { ...profile(ADULT, 1), hasPin: true },
        ];
        fake.server.revision = 2;
        await runtime.refresh();
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
    });

    it('falls back to Default when profiles were turned off elsewhere', async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        runtime.handleProfileError('profiles_disabled');
        expect(runtime.enabled()).toBe(false);
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        expect(readActiveProfileId(NAS)).toBe(ADULT);
    });

    it('ignores unrelated error codes', async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        runtime.handleProfileError('wrong_pin');
        expect(runtime.activeId()).toBe(ADULT);
    });

    it('probes the instance again on retry after a failure', async () => {
        const runtime = await start();
        expect(fake.calls('instance')).toHaveLength(1);
        fake.server.listStatus = 503;
        await runtime.refresh();
        expect(runtime.state()).toBe('offline');
        fake.server.listStatus = 200;
        await runtime.refresh();
        expect(fake.calls('instance')).toHaveLength(2);
        expect(runtime.state()).toBe('ready');
    });

    it('recheck probes the instance again', async () => {
        const runtime = await start();
        await runtime.recheck();
        expect(fake.calls('instance')).toHaveLength(2);
    });

    it('recheck does not join a refresh that started without an identity check', async () => {
        const runtime = await start();
        const probes = fake.calls('instance').length;
        const poll = runtime.refresh();
        await Promise.all([poll, runtime.recheck()]);
        expect(fake.calls('instance')).toHaveLength(probes + 1);
    });

    it('keeps the last list while offline or refused', async () => {
        const runtime = await start();
        const list = runtime.list();
        fake.server.offline = true;
        await runtime.refresh();
        expect(runtime.state()).toBe('offline');
        expect(runtime.list()).toBe(list);
        fake.server.offline = false;
        fake.server.listStatus = 403;
        await runtime.refresh();
        expect(runtime.state()).toBe('offline');
        expect(runtime.list()).toBe(list);
        fake.server.listStatus = 200;
        await runtime.refresh();
        expect(runtime.state()).toBe('ready');
    });

    it('re-probes after a failed probe', async () => {
        fake.server.offline = true;
        const runtime = await start();
        expect(runtime.state()).toBe('offline');
        fake.server.offline = false;
        await runtime.refresh();
        expect(runtime.capable()).toBe(true);
        expect(runtime.state()).toBe('ready');
    });

    it('shares one refresh between concurrent callers', async () => {
        const runtime = await start();
        const before = fake.request.mock.calls.length;
        const first = runtime.refresh();
        expect(runtime.refresh()).toBe(first);
        await first;
        expect(fake.request.mock.calls.length).toBe(before + 1);
    });

    it('polls every 30 seconds only while the page is visible', async () => {
        await start();
        const lists = () => fake.calls('profiles-list').length;
        const before = lists();
        await jest.advanceTimersByTimeAsync(PROFILES_POLL_MS - 1);
        expect(lists()).toBe(before);
        await jest.advanceTimersByTimeAsync(1);
        expect(lists()).toBe(before + 1);
        Object.defineProperty(document, 'hidden', {
            configurable: true,
            get: () => true,
        });
        await jest.advanceTimersByTimeAsync(PROFILES_POLL_MS * 3);
        expect(lists()).toBe(before + 1);
    });

    it('does not poll a server without the capability', async () => {
        fake.server.capabilities = ['sources-v1'];
        await start();
        await jest.advanceTimersByTimeAsync(PROFILES_POLL_MS * 3);
        expect(fake.request).toHaveBeenCalledTimes(1);
    });

    it('refreshes when the window regains focus or the page is shown', async () => {
        const runtime = await start();
        const before = fake.calls('profiles-list').length;
        window.dispatchEvent(new Event('focus'));
        await runtime.refresh();
        document.dispatchEvent(new Event('visibilitychange'));
        await runtime.refresh();
        expect(fake.calls('profiles-list').length).toBe(before + 2);
    });

    it('resets when the server connection goes away or changes', async () => {
        writeActiveProfileId(NAS, ADULT);
        const runtime = await start();
        localStorage.removeItem('iptvnator:source-server');
        await prepareSourceConnection();
        await runtime.refresh();
        expect(runtime.state()).toBe('idle');
        expect(runtime.list()).toBeNull();
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
        fake.server.instanceId = 'synthetic-other';
        await connect('synthetic-other');
        await runtime.refresh();
        expect(runtime.capable()).toBe(true);
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
    });

    it("keeps this tab's choice when another tab picks a profile", async () => {
        const runtime = await start();
        runtime.select(DEFAULT_PROFILE_ID);
        writeActiveProfileId(NAS, ADULT);
        window.dispatchEvent(
            new StorageEvent('storage', { key: activeProfileKey(NAS) })
        );
        fake.server.revision = 2;
        await runtime.refresh();
        expect(runtime.activeId()).toBe(DEFAULT_PROFILE_ID);
    });

    it('removes its listeners and timer when destroyed', async () => {
        await start();
        const before = fake.request.mock.calls.length;
        TestBed.resetTestingModule();
        window.dispatchEvent(new Event('focus'));
        await jest.advanceTimersByTimeAsync(PROFILES_POLL_MS * 2);
        expect(fake.request.mock.calls.length).toBe(before);
    });
});
