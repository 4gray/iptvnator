import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { PlaylistActions } from '@iptvnator/m3u-state';
import { XtreamConnectionTestService } from '@iptvnator/services';
import { XtreamCodeImportComponent } from './xtream-code-import.component';

describe('XtreamCodeImportComponent', () => {
    let component: XtreamCodeImportComponent;
    let store: { dispatch: jest.Mock };
    let connectionTestService: { test: jest.Mock };

    beforeEach(() => {
        store = {
            dispatch: jest.fn(),
        };
        connectionTestService = {
            test: jest.fn().mockResolvedValue({
                status: 'active',
                serverUrl: 'http://example.com',
                usedHttpFallback: true,
            }),
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: Store, useValue: store },
                {
                    provide: XtreamConnectionTestService,
                    useValue: connectionTestService,
                },
            ],
        });

        component = TestBed.runInInjectionContext(
            () => new XtreamCodeImportComponent()
        );
    });

    it('rejects file URLs for Xtream portals', () => {
        component.form.patchValue({
            title: 'Portal',
            serverUrl: 'file://example.com/portal',
            username: 'user',
            password: 'pass',
        });

        expect(component.form.valid).toBe(false);
    });

    it('rejects URLs with inline credentials before add or test actions', async () => {
        component.form.patchValue({
            title: 'Portal',
            serverUrl: 'https://user:pass@example.com',
            username: 'user',
            password: 'pass',
        });

        expect(component.form.valid).toBe(false);

        await component.testConnection();
        component.addPlaylist();

        expect(component.isTestingConnection).toBe(false);
        expect(connectionTestService.test).not.toHaveBeenCalled();
        expect(store.dispatch).not.toHaveBeenCalled();
    });

    it('extracts and trims username and password from a full Xtream URL', () => {
        component.extractParams(
            'https://example.com/get.php?username=%20user%20&password=%20pass%20&type=m3u_plus'
        );

        expect(component.form.get('username')?.value).toBe('user');
        expect(component.form.get('password')?.value).toBe('pass');
    });

    it('normalizes full Xtream playlist URLs when adding a portal', () => {
        component.form.patchValue({
            title: 'Portal',
            serverUrl:
                ' https://example.com/base/get.php?username=user&password=pass&type=m3u_plus ',
            username: ' user ',
            password: ' pass ',
        });

        component.addPlaylist();

        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.addPlaylist({
                playlist: expect.objectContaining({
                    password: 'pass',
                    serverUrl: 'https://example.com/base',
                    title: 'Portal',
                    username: 'user',
                }),
            })
        );
    });
    it('puts the tested HTTP address into the form and the added playlist', async () => {
        component.form.patchValue({
            title: 'Portal',
            serverUrl: 'https://example.com',
            username: 'user',
            password: 'pass',
        });
        await component.testConnection();
        expect(component.form.value.serverUrl).toBe('http://example.com');
        expect(component.connectionTest.messageKey()).toContain(
            'HTTP_CONNECTED'
        );
        component.addPlaylist();
        expect(store.dispatch).toHaveBeenCalledWith(
            PlaylistActions.addPlaylist({
                playlist: expect.objectContaining({
                    serverUrl: 'http://example.com',
                }),
            })
        );
    });

    it.each(['serverUrl', 'username', 'password', 'title'])(
        'discards a late result after editing %s',
        async (field) => {
            component.form.patchValue({
                title: 'Portal',
                serverUrl: 'https://example.com',
                username: 'user',
                password: 'pass',
            });
            let finish!: (result: unknown) => void;
            connectionTestService.test.mockReturnValue(
                new Promise((resolve) => {
                    finish = resolve;
                })
            );
            const pending = component.testConnection();
            component.addPlaylist();
            expect(store.dispatch).not.toHaveBeenCalled();
            component.form.get(field)?.setValue('new-value');
            finish({
                status: 'active',
                serverUrl: 'http://example.com',
                usedHttpFallback: true,
            });
            await pending;
            expect(component.connectionTest.result()).toBeNull();
            expect(component.form.get(field)?.value).toBe('new-value');
            expect(component.isTestingConnection).toBe(false);
        }
    );
    it('discards a pending result when the form is cleared', async () => {
        component.form.patchValue({
            title: 'Portal',
            serverUrl: 'https://example.com',
            username: 'user',
            password: 'pass',
        });
        let finish!: (result: unknown) => void;
        connectionTestService.test.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        const pending = component.testConnection();
        component.clearForm();
        finish({
            status: 'active',
            serverUrl: 'http://example.com',
            usedHttpFallback: true,
        });
        await pending;
        expect(component.form.value.serverUrl).toBe('');
        expect(component.connectionTest.result()).toBeNull();
    });

    it('does not update a destroyed form', async () => {
        component.form.patchValue({
            title: 'Portal',
            serverUrl: 'https://example.com',
            username: 'user',
            password: 'pass',
        });
        let finish!: (result: unknown) => void;
        connectionTestService.test.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        const pending = component.testConnection();
        TestBed.resetTestingModule();
        finish({
            status: 'active',
            serverUrl: 'http://example.com',
            usedHttpFallback: true,
        });
        await pending;
        expect(component.form.value.serverUrl).toBe('https://example.com');
        expect(component.connectionTest.result()).toBeNull();
    });
});
