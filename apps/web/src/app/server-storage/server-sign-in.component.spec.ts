import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import {
    ServerApiError,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
import { ServerSignInComponent } from './server-sign-in.component';

const TOKEN_KEY = 'iptvnator-server:access-token';

describe('ServerSignInComponent', () => {
    let fixture: ComponentFixture<ServerSignInComponent>;
    let component: ServerSignInComponent;
    const session = { fetchStatus: jest.fn() };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ServerSignInComponent, TranslateModule.forRoot()],
            providers: [{ provide: ServerStorageSession, useValue: session }],
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
});
