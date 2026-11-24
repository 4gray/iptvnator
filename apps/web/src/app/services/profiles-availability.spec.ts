import { TestBed } from '@angular/core/testing';
import { prepareSourceConnection } from '@iptvnator/services/source-sync/connection';
import { fakeRuntime } from '../profiles/profiles.stub';
import { profilesAvailabilityFactory } from './profiles-availability';
import { PROFILES_REQUEST } from './profiles-request.token';
import { ProfilesRuntime } from './profiles-runtime';
import { PROFILES_UI_ENABLED_TOKEN } from './profiles-ui-enabled';

async function connect(instanceId: string | null): Promise<void> {
    localStorage.clear();
    if (instanceId)
        localStorage.setItem(
            'iptvnator:source-server',
            JSON.stringify({ apiUrl: 'https://nas.example/api', instanceId })
        );
    await prepareSourceConnection();
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('profilesAvailabilityFactory', () => {
    it('stays false without touching the network while the UI switch is off', async () => {
        await connect('synthetic-nas');
        const request = jest.fn();
        const fake = fakeRuntime();
        TestBed.configureTestingModule({
            providers: [
                { provide: PROFILES_UI_ENABLED_TOKEN, useValue: false },
                { provide: PROFILES_REQUEST, useValue: request },
                { provide: ProfilesRuntime, useValue: fake.runtime },
            ],
        });
        const available = TestBed.runInInjectionContext(
            profilesAvailabilityFactory
        );
        await settle();
        TestBed.tick();
        expect(available()).toBe(false);
        expect(request).not.toHaveBeenCalled();
        expect(fake.runtime.refresh).not.toHaveBeenCalled();
    });

    it('is true once a connected server is capable, and false when it is not', async () => {
        await connect('synthetic-nas');
        const fake = fakeRuntime();
        fake.runtime.capable.set(false);
        TestBed.configureTestingModule({
            providers: [
                { provide: PROFILES_UI_ENABLED_TOKEN, useValue: true },
                { provide: ProfilesRuntime, useValue: fake.runtime },
            ],
        });
        const available = TestBed.runInInjectionContext(
            profilesAvailabilityFactory
        );
        fake.runtime.state.set('checking');
        await settle();
        TestBed.tick();
        // Not answered yet: a direct visit to the section waits.
        expect(available()).toBe(true);
        fake.runtime.state.set('unsupported');
        TestBed.tick();
        expect(available()).toBe(false);
        fake.runtime.capable.set(true);
        fake.runtime.state.set('ready');
        TestBed.tick();
        expect(available()).toBe(true);
    });

    it('is false without a connected server', async () => {
        await connect(null);
        const fake = fakeRuntime();
        TestBed.configureTestingModule({
            providers: [
                { provide: PROFILES_UI_ENABLED_TOKEN, useValue: true },
                { provide: ProfilesRuntime, useValue: fake.runtime },
            ],
        });
        const available = TestBed.runInInjectionContext(
            profilesAvailabilityFactory
        );
        await settle();
        TestBed.tick();
        expect(available()).toBe(false);
    });
});
