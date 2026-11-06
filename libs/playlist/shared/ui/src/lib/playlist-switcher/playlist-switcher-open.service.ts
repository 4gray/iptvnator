import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * Opens the toolbar playlist switcher from outside it: the ⌘P / Ctrl+P
 * shortcut. The switcher subscribes while it is on screen (it is hidden on
 * Settings), so a request with no switcher does nothing.
 */
@Injectable({ providedIn: 'root' })
export class PlaylistSwitcherOpenService {
    private readonly requests = new Subject<void>();
    readonly openRequests = this.requests.asObservable();
    private listeners = 0;

    /** Whether a switcher is on screen to take the request. */
    get available(): boolean {
        return this.listeners > 0;
    }

    request(): void {
        this.requests.next();
    }

    /** Called by the switcher; the returned function unregisters it. */
    register(): () => void {
        this.listeners += 1;
        return () => {
            this.listeners -= 1;
        };
    }
}
