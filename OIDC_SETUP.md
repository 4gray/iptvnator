# OIDC Authentication Setup Guide

This project has been configured with OIDC (OpenID Connect) authentication using the `oidc-client` library. This guide will help you configure and use the authentication system.

## Configuration

### 1. Update Environment Files

You need to configure your OIDC provider settings in the environment files:

- `src/environments/environment.ts` (local development)
- `src/environments/environment.dev.ts` (dev environment)
- `src/environments/environment.prod.ts` (production)
- `src/environments/environment.web.ts` (web environment)

Update the `OIDC_CONFIG` object with your OIDC provider details:

```typescript
OIDC_CONFIG: {
    authority: 'https://your-oidc-provider.com',  // Your OIDC provider URL
    client_id: 'your-client-id',                       // Your client ID
    redirect_uri: `${window.location.origin}/auth-callback`,
    response_type: 'code',
    scope: 'openid profile email',
    post_logout_redirect_uri: `${window.location.origin}/`,
    automaticSilentRenew: true,
    filterProtocolClaims: true,
    loadUserInfo: true,
    silent_redirect_uri: `${window.location.origin}/silent-refresh.html`,
}
```

### 2. OIDC Provider Configuration

Make sure your OIDC provider is configured with:
- **Redirect URI**: `http://localhost:4200/auth-callback` (for local development)
- **Post Logout Redirect URI**: `http://localhost:4200/`
- **Silent Refresh URI**: `http://localhost:4200/silent-refresh.html`
- **Response Type**: `code` (Authorization Code Flow)
- **Grant Type**: `authorization_code`

For production, update these URIs to match your production domain.

## Usage

### Protecting Routes

To protect a route, add the `authGuard` to the route configuration in `src/app/app-routing.module.ts`:

```typescript
{
    path: 'protected-route',
    loadComponent: () => import('./protected/protected.component').then(c => c.ProtectedComponent),
    canActivate: [authGuard],  // Add this line
}
```

### Using the Auth Service

The `AuthService` provides several methods and observables:

#### Methods:
- `login()`: Initiates the login process
- `logout()`: Logs out the current user
- `getUser()`: Returns an Observable of the current user
- `getAccessToken()`: Returns an Observable of the access token
- `isAuthenticated()`: Returns an Observable indicating if the user is authenticated
- `renewToken()`: Manually renews the access token

#### Observables:
- `user$`: Observable that emits the current user
- `isAuthenticated$`: Observable that emits authentication status

#### Example Usage in a Component:

```typescript
import { Component, OnInit } from '@angular/core';
import { AuthService } from './services/auth/auth.service';

@Component({
    selector: 'app-example',
    template: `
        <div *ngIf="isAuthenticated$ | async">
            <p>Welcome, {{ (user$ | async)?.profile?.name }}!</p>
            <button (click)="logout()">Logout</button>
        </div>
        <div *ngIf="!(isAuthenticated$ | async)">
            <button (click)="login()">Login</button>
        </div>
    `
})
export class ExampleComponent implements OnInit {
    user$ = this.authService.user$;
    isAuthenticated$ = this.authService.isAuthenticated$;

    constructor(private authService: AuthService) {}

    ngOnInit() {
        // Component initialization
    }

    login() {
        this.authService.login();
    }

    logout() {
        this.authService.logout();
    }
}
```

### HTTP Interceptor

The `authInterceptor` automatically adds the access token to all HTTP requests. It's already configured in the app module, so you don't need to do anything additional. All requests made using Angular's `HttpClient` will automatically include the `Authorization: Bearer <token>` header.

## Files Created

The following files were added for OIDC authentication:

1. **`src/app/services/auth/oidc-config.interface.ts`**: Interface for OIDC configuration
2. **`src/app/services/auth/auth.service.ts`**: Main authentication service
3. **`src/app/services/auth/auth.guard.ts`**: Route guard for protecting routes
4. **`src/app/services/auth/auth.interceptor.ts`**: HTTP interceptor for adding tokens
5. **`src/app/auth-callback/auth-callback.component.ts`**: Component for handling OIDC callback
6. **`src/silent-refresh.html`**: HTML file for silent token refresh

## Features

- ✅ Automatic token refresh
- ✅ Silent token renewal
- ✅ Route protection
- ✅ Automatic token injection in HTTP requests
- ✅ User state management with RxJS observables
- ✅ Redirect to originally requested URL after login

## Testing

1. Start your development server: `npm run serve`
2. Navigate to a protected route (if you've enabled the guard)
3. You should be redirected to your OIDC provider's login page
4. After successful login, you'll be redirected back to the application

## Troubleshooting

### Token not being added to requests
- Make sure the `authInterceptor` is properly configured in `app.module.ts`
- Check that the user is authenticated by subscribing to `authService.isAuthenticated$`

### Redirect loop
- Verify your redirect URIs match exactly in both the application and OIDC provider
- Check that the `auth-callback` route is properly configured

### Silent refresh not working
- Ensure `silent-refresh.html` is included in your build assets (check `angular.json`)
- Verify the `silent_redirect_uri` is correctly configured in your OIDC provider

## Security Notes

- Never commit your OIDC configuration with real credentials to version control
- Use environment variables for sensitive configuration in production
- Ensure your OIDC provider uses HTTPS in production
- Regularly rotate your client secrets


