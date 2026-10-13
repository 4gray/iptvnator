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
    writeServerAccessToken,
} from '@iptvnator/services';
import {
    SERVER_STORAGE_CONFIG,
    ServerApiError,
    ServerStorageSession,
} from '@iptvnator/services/server-storage';
import { rememberServer } from './server-storage-start';
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
        // Every request and the reload read the token from storage, and the
        // next start keeps it only for the server it remembers.
        if (
            !writeServerAccessToken(token) ||
            !rememberServer(this.config.baseUrl, this.config.instance)
        ) {
            clearServerAccessToken();
            this.feedback.set('storage');
            return;
        }
        this.busy.set(true);
        this.feedback.set(null);
        try {
            await this.session.fetchStatus();
            this.openWorkspace();
        } catch (error) {
            clearServerAccessToken();
            this.feedback.set(
                error instanceof ServerApiError && error.status === 401
                    ? 'rejected'
                    : 'unreachable'
            );
        } finally {
            this.busy.set(false);
        }
    }

    /** Full reload so every service starts with the token. */
    openWorkspace(): void {
        window.location.assign(new URL('workspace', document.baseURI).href);
    }
}
