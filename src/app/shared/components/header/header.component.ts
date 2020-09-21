import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'app-header',
    templateUrl: './header.component.html',
    styleUrls: ['./header.component.scss'],
})
export class HeaderComponent {
    /** Title of the header */
    @Input() title: string;
    /** Subtitle of the header */
    @Input() subtitle: string;

    /** Creates an instance of SettingsComponent and injects angulars router module
     * @param router angulars router
     */
    constructor(private router: Router) {}

    /**
     * Navigates to the settings page
     */
    openSettings(): void {
        this.router.navigate(['/settings']);
    }
}
