import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    SERVER_STORAGE_CONFIG,
    ServerApiError,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
import { REMEMBERED_SERVER_KEY } from './server-storage-start';
import { ServerSignInComponent } from './server-sign-in.component';

const TOKEN_KEY = 'iptvnator-server:access-token';

describe('ServerSignInComponent', () => {
    let fixture: ComponentFixture<ServerSignInComponent>;
    let component: ServerSignInComponent;
    const session = { fetchStatus: jest.fn() };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ServerSignInComponent, TranslateModule.forRoot()],
            providers: [
                { provide: ServerStorageSession, useValue: session },
                {
                    provide: SERVER_STORAGE_CONFIG,
                    useValue: {
                        baseUrl: '/api',
                        instance: {
                            service: 'iptvnator',
                            apiVersion: 1,
                            instanceId: 'i-1',
                            storage: 'server',
                            auth: 'token',
                        },
                    },
                },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(ServerSignInComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    afterEach(() => {
        localStorage.clear();
        jest.resetAllMocks();
    });

    const feedbackText = () =>
        fixture.nativeElement
            .querySelector('[data-test-id="server-sign-in-feedback"]')
            .textContent.trim();

    it('keeps an accepted token and reloads into the workspace', async () => {
        session.fetchStatus.mockResolvedValue({ playlists: 0 });
        const open = jest
            .spyOn(component, 'openWorkspace')
            .mockImplementation(() => undefined);

        component.edit(' right ');
        await component.submit(new Event('submit'));

        expect(localStorage.getItem(TOKEN_KEY)).toBe('right');
        expect(open).toHaveBeenCalled();
    });

    it('says the token was refused and forgets it', async () => {
        session.fetchStatus.mockRejectedValue(
            new ServerApiError(401, 'unauthorized', 'refused')
        );

        component.edit('wrong');
        await component.submit(new Event('submit'));
        fixture.detectChanges();

        expect(component.feedback()).toBe('rejected');
        expect(feedbackText()).toBe('SERVER_STORAGE.SIGN_IN_REJECTED');
        expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('tells an unreachable server apart and clears the message on edit', async () => {
        session.fetchStatus.mockRejectedValue(
            new ServerApiError(0, undefined, 'offline')
        );

        component.edit('token');
        await component.submit(new Event('submit'));
        fixture.detectChanges();
        expect(feedbackText()).toBe('SERVER_STORAGE.SIGN_IN_UNREACHABLE');

        component.edit('token2');
        fixture.detectChanges();
        expect(feedbackText()).toBe('');
    });

    it('does not submit an empty token', async () => {
        component.edit('   ');
        await component.submit(new Event('submit'));

        expect(session.fetchStatus).not.toHaveBeenCalled();
        expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('says when the browser will not keep the token', async () => {
        const refuse = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new DOMException('full', 'QuotaExceededError');
            });
        try {
            component.edit('right');
            await component.submit(new Event('submit'));
            fixture.detectChanges();
        } finally {
            refuse.mockRestore();
        }

        expect(session.fetchStatus).not.toHaveBeenCalled();
        expect(feedbackText()).toBe('SERVER_STORAGE.SIGN_IN_STORAGE');
    });

    it('remembers the server the token was accepted for', async () => {
        session.fetchStatus.mockResolvedValue({ playlists: 0 });
        jest.spyOn(component, 'openWorkspace').mockImplementation(
            () => undefined
        );

        component.edit('right');
        await component.submit(new Event('submit'));

        expect(
            JSON.parse(localStorage.getItem(REMEMBERED_SERVER_KEY) ?? '{}')
        ).toMatchObject({ baseUrl: '/api', instance: { instanceId: 'i-1' } });
    });

    it('signs in only when the server can be remembered too', async () => {
        const refuse = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation((key: string) => {
                if (key === REMEMBERED_SERVER_KEY) {
                    throw new DOMException('full', 'QuotaExceededError');
                }
            });
        try {
            component.edit('right');
            await component.submit(new Event('submit'));
            fixture.detectChanges();
        } finally {
            refuse.mockRestore();
        }

        expect(session.fetchStatus).not.toHaveBeenCalled();
        expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
        expect(feedbackText()).toBe('SERVER_STORAGE.SIGN_IN_STORAGE');
    });
});
