import {
    ChangeDetectionStrategy,
    Component,
    inject,
    signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '@ngx-translate/core';
import {
    clearServerAccessToken,
    readServerAccessToken,
    writeServerAccessToken,
} from '@iptvnator/services';
import {
    SERVER_STORAGE_CONFIG,
    ServerApiError,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
import { rememberServer } from './server-storage-start';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { PasswordVisibilityToggleDirective } from '@iptvnator/ui/components/password-visibility-toggle';

export type ServerSignInFeedback = 'rejected' | 'unreachable' | 'storage';

@Component({
    selector: 'app-server-sign-in',
    imports: [
        MatButtonModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        PasswordVisibilityToggleDirective,
        TranslatePipe,
    ],
    providers: [provideFormFieldDefaults()],
    templateUrl: './server-sign-in.component.html',
    styleUrl: './server-sign-in.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerSignInComponent {
    private readonly session = inject(ServerStorageSession);
    private readonly config = inject(SERVER_STORAGE_CONFIG);

    readonly token = signal('');
    readonly busy = signal(false);
    readonly feedback = signal<ServerSignInFeedback | null>(null);

    edit(value: string): void {
        this.token.set(value);
        this.feedback.set(null);
    }

    async submit(event: Event): Promise<void> {
        event.preventDefault();
        const token = this.token().trim();
        if (!token || this.busy()) {
            return;
        }
        this.busy.set(true);
        this.feedback.set(null);
        try {
            // A page started from memory checks the server first: the token
            // must reach only the one it is meant for.
            await this.session.ensureVerified();
        } catch {
            this.feedback.set('unreachable');
            this.busy.set(false);
            return;
        }
        // Every request and the reload read the token from storage, and the
        // next start keeps it only for the server it remembers.
        if (
            !writeServerAccessToken(token, this.config.instance.instanceId) ||
            !rememberServer(this.config.baseUrl, this.config.instance)
        ) {
            forgetAttempt(token);
            this.feedback.set('storage');
            this.busy.set(false);
            return;
        }
        try {
            await this.session.fetchStatus();
            this.openWorkspace();
        } catch (error) {
            const rejected =
                error instanceof ServerApiError && error.status === 401;
            // A refused token is no one's. A network failure says nothing
            // about it, and another tab may have stored the same one since.
            if (rejected) {
                forgetAttempt(token);
            }
            this.feedback.set(rejected ? 'rejected' : 'unreachable');
        } finally {
            this.busy.set(false);
        }
    }

    /** Full reload so every service starts with the token. */
    openWorkspace(): void {
        window.location.assign(new URL('workspace', document.baseURI).href);
    }
}

/**
 * Forgets a token whose sign-in failed, unless another tab has signed in
 * since: its token replaced this one and is not this attempt's to clear.
 */
function forgetAttempt(token: string): void {
    if (readServerAccessToken() === token) {
        clearServerAccessToken();
    }
}
