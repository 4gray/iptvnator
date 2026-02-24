/** @type {import('tailwindcss').Config} */
module.exports = {
    // Content paths scoped to the Angular web app and shared libs
    content: [
        './apps/web/src/**/*.{html,ts,scss}',
        './libs/**/*.{html,ts,scss}',
    ],
    // Match Angular Material's dark theme class strategy
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'Roboto', 'Helvetica Neue', 'sans-serif'],
            },
            colors: {
                // Surface colors wired to Material sys vars so Tailwind
                // utilities automatically respect the active theme
                surface: 'var(--mat-sys-surface)',
                'surface-low': 'var(--mat-sys-surface-container-low)',
                'surface-mid': 'var(--mat-sys-surface-container)',
                'surface-high': 'var(--mat-sys-surface-container-high)',
                'on-surface': 'var(--mat-sys-on-surface)',
                'on-surface-variant': 'var(--mat-sys-on-surface-variant)',
                outline: 'var(--mat-sys-outline)',
                'outline-variant': 'var(--mat-sys-outline-variant)',
                primary: 'var(--mat-sys-primary)',
                'on-primary': 'var(--mat-sys-on-primary)',
                'primary-container': 'var(--mat-sys-primary-container)',
                'on-primary-container': 'var(--mat-sys-on-primary-container)',
                secondary: 'var(--mat-sys-secondary)',
                'secondary-container': 'var(--mat-sys-secondary-container)',
                'on-secondary-container':
                    'var(--mat-sys-on-secondary-container)',
                tertiary: 'var(--mat-sys-tertiary)',
                'tertiary-container': 'var(--mat-sys-tertiary-container)',
                error: 'var(--mat-sys-error)',
                'error-container': 'var(--mat-sys-error-container)',
            },
            borderRadius: {
                widget: '14px',
                pill: '999px',
                card: '18px',
            },
            boxShadow: {
                widget: '0 1px 4px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.04)',
                'widget-hover':
                    '0 4px 16px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.06)',
                card: '0 2px 8px rgba(0,0,0,0.15)',
            },
        },
    },
    // CRITICAL: disable preflight to avoid conflicts with Angular Material
    corePlugins: {
        preflight: false,
    },
};
