import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { ServerStorageStatusService } from '@iptvnator/services';
import { serverAccessGuard, serverSignInGuard } from './server-access.guard';

describe('server access guards', () => {
    function run(guard: typeof serverAccessGuard, state: string) {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                provideRouter([]),
                {
                    provide: ServerStorageStatusService,
                    useValue: { state: () => state },
                },
            ],
        });
        return TestBed.runInInjectionContext(() =>
            guard({} as never, {} as never)
        );
    }

    const serialize = (result: unknown) =>
        TestBed.inject(Router).serializeUrl(result as UrlTree);

    afterEach(() => TestBed.resetTestingModule());

    it('sends an unauthorized workspace visit to the sign-in page', () => {
        expect(serialize(run(serverAccessGuard, 'unauthorized'))).toBe(
            '/server-sign-in'
        );
    });

    it('lets everyone else into the workspace', () => {
        expect(run(serverAccessGuard, 'online')).toBe(true);
        expect(run(serverAccessGuard, 'offline')).toBe(true);
        expect(run(serverAccessGuard, 'inactive')).toBe(true);
    });

    it('opens the sign-in page only while unauthorized', () => {
        expect(run(serverSignInGuard, 'unauthorized')).toBe(true);
        expect(serialize(run(serverSignInGuard, 'online'))).toBe('/workspace');
        expect(serialize(run(serverSignInGuard, 'inactive'))).toBe(
            '/workspace'
        );
    });
});
