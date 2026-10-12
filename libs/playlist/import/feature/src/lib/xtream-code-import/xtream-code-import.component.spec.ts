import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
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

        await component.testConnection(true);
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
        await component.testConnection(true);
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
            const pending = component.testConnection(true);
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
        const pending = component.testConnection(true);
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
        const pending = component.testConnection(true);
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

describe('XtreamCodeImportComponent form', () => {
    function render() {
        TestBed.configureTestingModule({
            imports: [XtreamCodeImportComponent, TranslateModule.forRoot()],
            providers: [
                { provide: Store, useValue: { dispatch: jest.fn() } },
                {
                    provide: XtreamConnectionTestService,
                    useValue: { test: jest.fn() },
                },
            ],
        });
        const fixture = TestBed.createComponent(XtreamCodeImportComponent);
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        return { fixture, root, component: fixture.componentInstance };
    }

    function fieldText(root: HTMLElement, inputId: string): string {
        return (
            root
                .querySelector(`#${inputId}`)
                ?.closest('mat-form-field')
                ?.textContent?.replace(/\s+/g, ' ')
                .trim() ?? ''
        );
    }

    it('labels the name field like the other add-source forms', () => {
        const { root } = render();

        expect(fieldText(root, 'title')).toContain(
            'HOME.XTREAM_PLAYLIST.TITLE'
        );
    });

    it('masks the password until the visibility toggle is pressed', () => {
        const { fixture, root } = render();
        const password = root.querySelector('#password') as HTMLInputElement;
        const toggle = password
            .closest('mat-form-field')
            ?.querySelector('button') as HTMLButtonElement;

        expect(password.type).toBe('password');
        expect(toggle.type).toBe('button');
        expect(toggle.getAttribute('aria-label')).toBe('HOME.SHOW_PASSWORD');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');

        toggle.click();
        fixture.detectChanges();
        expect(password.type).toBe('text');
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        expect(toggle.getAttribute('aria-label')).toBe('HOME.SHOW_PASSWORD');

        toggle.click();
        fixture.detectChanges();
        expect(password.type).toBe('password');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
    });

    it('masks the password again when the form is cleared', () => {
        const { fixture, root, component } = render();
        const password = root.querySelector('#password') as HTMLInputElement;
        const toggle = password
            .closest('mat-form-field')
            ?.querySelector('button') as HTMLButtonElement;

        toggle.click();
        fixture.detectChanges();
        expect(password.type).toBe('text');

        component.clearForm();
        fixture.detectChanges();

        expect(password.type).toBe('password');
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
    });

    it('shows a neutral server hint until the URL is invalid', () => {
        const { fixture, root, component } = render();

        expect(fieldText(root, 'serverUrl')).toContain(
            'HOME.XTREAM_PLAYLIST.URL_HINT'
        );
        expect(root.querySelector('mat-error')).toBeNull();

        component.form.controls.serverUrl.setValue('ftp://panel.example');
        component.form.controls.serverUrl.markAsTouched();
        fixture.detectChanges();

        const error = root.querySelector('mat-error');
        expect(error?.textContent?.trim()).toBe(
            'HOME.XTREAM_PLAYLIST.URL_VALIDATION_ERROR'
        );
        expect(fieldText(root, 'serverUrl')).not.toContain(
            'SETTINGS.EPG_URL_ERROR'
        );
    });

    it('explains a URL that carries inline credentials as invalid', () => {
        const { fixture, root, component } = render();

        component.form.controls.serverUrl.setValue(
            'https://user:pass@panel.example'
        );
        component.form.controls.serverUrl.markAsTouched();
        fixture.detectChanges();

        expect(root.querySelector('mat-error')?.textContent?.trim()).toBe(
            'HOME.XTREAM_PLAYLIST.URL_VALIDATION_ERROR'
        );
    });
});
