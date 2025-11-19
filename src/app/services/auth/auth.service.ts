import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { User, UserManager, UserManagerSettings } from 'oidc-client';
import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AppConfig } from '../../../environments/environment';

@Injectable({
    providedIn: 'root',
})
export class AuthService {
    private userManager: UserManager;
    private userSubject = new BehaviorSubject<User | null>(null);
    public user$ = this.userSubject.asObservable();
    private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
    public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();
    public redirectUrl: string | null = null;

    constructor(private router: Router) {
        const settings: UserManagerSettings = {
            authority: AppConfig.OIDC_CONFIG.authority,
            client_id: AppConfig.OIDC_CONFIG.client_id,
            redirect_uri: AppConfig.OIDC_CONFIG.redirect_uri,
            response_type: AppConfig.OIDC_CONFIG.response_type || 'code',
            scope: AppConfig.OIDC_CONFIG.scope || 'openid profile email',
            post_logout_redirect_uri:
                AppConfig.OIDC_CONFIG.post_logout_redirect_uri ||
                window.location.origin,
            automaticSilentRenew:
                AppConfig.OIDC_CONFIG.automaticSilentRenew ?? true,
            filterProtocolClaims:
                AppConfig.OIDC_CONFIG.filterProtocolClaims ?? true,
            loadUserInfo: AppConfig.OIDC_CONFIG.loadUserInfo ?? true,
            silent_redirect_uri:
                AppConfig.OIDC_CONFIG.silent_redirect_uri ||
                `${window.location.origin}/silent-refresh.html`,
        };

        this.userManager = new UserManager(settings);

        // Listen for user loaded events
        this.userManager.events.addUserLoaded((user) => {
            this.userSubject.next(user);
            this.isAuthenticatedSubject.next(true);
        });

        // Listen for user unloaded events
        this.userManager.events.addUserUnloaded(() => {
            this.userSubject.next(null);
            this.isAuthenticatedSubject.next(false);
        });

        // Listen for access token expiring
        this.userManager.events.addAccessTokenExpiring(() => {
            console.log('Access token expiring, attempting silent renew...');
        });

        // Listen for silent renew errors
        this.userManager.events.addSilentRenewError((error) => {
            console.error('Silent renew error:', error);
            this.logout();
        });

        // Check if user is already loaded
        this.userManager.getUser().then((user) => {
            if (user && !user.expired) {
                this.userSubject.next(user);
                this.isAuthenticatedSubject.next(true);
            } else {
                this.userSubject.next(null);
                this.isAuthenticatedSubject.next(false);
            }
        });
    }

    /**
     * Initiates the login process by redirecting to the OIDC provider
     */
    login(): Promise<void> {
        return this.userManager.signinRedirect();
    }

    /**
     * Handles the redirect callback from the OIDC provider
     */
    handleCallback(): Observable<User> {
        return from(this.userManager.signinRedirectCallback()).pipe(
            map((user) => {
                this.userSubject.next(user);
                this.isAuthenticatedSubject.next(true);
                return user;
            }),
            catchError((error) => {
                console.error('Error handling callback:', error);
                this.userSubject.next(null);
                this.isAuthenticatedSubject.next(false);
                throw error;
            })
        );
    }

    /**
     * Logs out the current user
     */
    logout(): Promise<void> {
        this.userSubject.next(null);
        this.isAuthenticatedSubject.next(false);
        return this.userManager.signoutRedirect();
    }

    /**
     * Gets the current user
     */
    getUser(): Observable<User | null> {
        return from(this.userManager.getUser()).pipe(
            map((user) => {
                if (user && !user.expired) {
                    this.userSubject.next(user);
                    this.isAuthenticatedSubject.next(true);
                    return user;
                } else {
                    this.userSubject.next(null);
                    this.isAuthenticatedSubject.next(false);
                    return null;
                }
            }),
            catchError(() => {
                this.userSubject.next(null);
                this.isAuthenticatedSubject.next(false);
                return of(null);
            })
        );
    }

    /**
     * Gets the access token for the current user
     */
    getAccessToken(): Observable<string | null> {
        return this.getUser().pipe(
            map((user) => (user && !user.expired ? user.access_token : null))
        );
    }

    /**
     * Checks if the user is authenticated
     */
    isAuthenticated(): Observable<boolean> {
        return this.getUser().pipe(map((user) => user !== null && !user.expired));
    }

    /**
     * Renews the access token silently
     */
    renewToken(): Promise<User> {
        return this.userManager.signinSilent();
    }

    /**
     * Gets the current user synchronously (from BehaviorSubject)
     */
    getCurrentUser(): User | null {
        return this.userSubject.value;
    }

    /**
     * Checks if the user is authenticated synchronously
     */
    isAuthenticatedSync(): boolean {
        const user = this.userSubject.value;
        return user !== null && !user.expired;
    }
}

