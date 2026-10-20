import assert from 'node:assert/strict';
import { INSTALLER_SKIN } from '../apps/brand.js';

import { createTheme } from '../apps/theme-model.js';

// The installer skin must pass the shell's own validation (contrast included):
// configureTheme falls back to the default skin when it does not.
const theme = createTheme(INSTALLER_SKIN);
const hex = value => '#' + value.slice(0, 3).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
assert.equal(hex(theme.surface.background), '#0b0f12');
assert.equal(hex(theme.surface.accent), '#d96a1d');
assert.equal(hex(theme.surface.card), '#1e272e');
assert.equal(hex(theme.surface.selected), '#14343a');
assert.equal(hex(theme.text.primary), '#e8ecef');
console.log('Installer colours: passed');
