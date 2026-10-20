// The installer uses Koya's website colours rather than the skin in the
// bundled desktop profile: a dark background and panels, slate surfaces,
// orange for the main action, amber for warnings and teal for a selected row.
export const INSTALLER_SKIN = {
  name: 'Koya',
  palette: { background: '#0b0f12', foreground: '#e8ecef', accent: '#d96a1d', warn: '#f2a33a' },
  overrides: {
    surface: { overlay: '#12181df5', card: '#1e272e', control: '#2a343d', selected: '#14343a' },
    text: { secondary: '#a7b0b7', disabled: '#6f7a83' },
    // The panel edge is only just lighter than the panel, as faint as the
    // line where the rail meets it.
    border: { surface: '#1e272e' }
  }
};
export const INSTALLER_WALLPAPER = {
  gradient: {
    type: 'radial', size: { x: 1024, y: 1024 },
    radial: { center: { x: 0.5, y: 0.5 }, radius: 0.5 },
    stops: [
      { at: 0, colour: [20 / 255, 43 / 255, 48 / 255, 1] },
      { at: 1, colour: [11 / 255, 15 / 255, 18 / 255, 1] }
    ]
  },
  corners: [
    { texture: '/rom/assets/installer-koi-bottom-left.png', size: { x: 1254, y: 1254 }, corner: 'bottom-left' },
    { texture: '/rom/assets/installer-koi-top-right.png', size: { x: 1254, y: 1254 }, corner: 'top-right' }
  ]
};

export const installerTheme = () => ({ Skin: JSON.stringify(INSTALLER_SKIN) });
