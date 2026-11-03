import { render } from 'preact';
import { TvApp } from '@iptvnator/tv/feature';
import './theme.css';
import './live-overlay.css';
import './programme-guide.css';
import './grid-guide.css';
const root = document.getElementById('app');
if (!root) throw new Error('Missing TV application root');
render(<TvApp buildInfo={__TV_BUILD_INFO__} />, root);

import './settings.css';
import './dialog.css';
import './about.css';
