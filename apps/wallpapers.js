// Centre-crop to fill, preserving the artwork's aspect ratio on any display.
export function wallpaperFrame(wallpaper, size, colour = [1, 1, 1, 1]) {
  const scale = Math.max(size.x / wallpaper.size.x, size.y / wallpaper.size.y);
  const crop = { x: size.x / scale, y: size.y / scale };
  const min = { x: (wallpaper.size.x - crop.x) / 2, y: (wallpaper.size.y - crop.y) / 2 };
  return { size, origin: { x: 0, y: 0 }, aabb: { min, max: { x: min.x + crop.x, y: min.y + crop.y } }, colour };
}

// Keep corner detail at a bounded logical size, even on ultrawide displays.
// The engine handles display scaling; sample the entire high-resolution asset.
export function wallpaperCorner(art, canvas) {
  const scale = Math.min(600 / Math.max(art.size.x, art.size.y),
    canvas.x * 0.48 / art.size.x, canvas.y * 0.8 / art.size.y);
  const size = { x: Math.round(art.size.x * scale), y: Math.round(art.size.y * scale) };
  return {
    position: { x: art.corner === 'top-right' ? canvas.x - size.x : 0,
      y: art.corner === 'bottom-left' ? canvas.y - size.y : 0 },
    size,
    frame: { size, origin: { x: 0, y: 0 }, aabb: { min: { x: 0, y: 0 }, max: { ...art.size } }, colour: [1, 1, 1, 1] }
  };
}
