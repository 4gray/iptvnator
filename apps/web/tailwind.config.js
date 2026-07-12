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
                // Surface colors wired to the --app-* design tokens
                // (m3-theme.scss) so Tailwind utilities automatically respect
                // the active theme. Never wire these to --mat-sys-* vars: the
                // current Material theme setup does not emit system tokens
                // (see docs/architecture/theme-design-tokens.md).
                surface: 'var(--app-content-bg)',
                'surface-low': 'var(--app-widget-bg)',
                'surface-mid': 'var(--app-widget-bg)',
                'surface-high': 'var(--app-widget-header-bg)',
                'on-surface': 'var(--app-heading-color)',
                'on-surface-variant': 'var(--app-body-color)',
                outline: 'var(--app-separator)',
                'outline-variant': 'var(--app-separator)',
                primary: 'var(--app-selection-color)',
                'on-primary': 'var(--app-selection-on-color)',
                'primary-container': 'var(--app-selection-surface)',
                'on-primary-container': 'var(--app-selection-color)',
                secondary: 'var(--app-body-color)',
                'secondary-container': 'var(--app-hover-overlay)',
                'on-secondary-container': 'var(--app-heading-color)',
                tertiary: 'var(--app-accent-color)',
                'tertiary-container':
                    'color-mix(in srgb, var(--app-accent-color) 15%, transparent)',
                error: 'var(--app-error-color)',
                'error-container':
                    'color-mix(in srgb, var(--app-error-color) 12%, transparent)',
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
