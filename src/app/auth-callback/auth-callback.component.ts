import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../services/auth/auth.service';

@Component({
    selector: 'app-auth-callback',
    template: `
        <div style="display: flex; justify-content: center; align-items: center; height: 100vh;">
            <div>
                <h2>Completing authentication...</h2>
                <p>Please wait while we redirect you.</p>
            </div>
        </div>
    `,
    standalone: true,
    imports: [CommonModule],
})
export class AuthCallbackComponent implements OnInit {
    constructor(
        private authService: AuthService,
        private router: Router
    ) {}

    ngOnInit(): void {
        this.authService.handleCallback().subscribe({
            next: () => {
                // Redirect to home or the originally requested URL
                const redirectUrl = this.authService.redirectUrl || '/';
                this.authService.redirectUrl = null; // Clear the redirect URL
                this.router.navigateByUrl(redirectUrl);
            },
            error: (error) => {
                console.error('Authentication error:', error);
                this.router.navigateByUrl('/');
            },
        });
    }
}

