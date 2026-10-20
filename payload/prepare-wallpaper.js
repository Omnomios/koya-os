import * as Desktop from 'Module/desktop';
import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
export default function main() {
  setTimeout(async () => {
    try {
      const wallpapers = await Desktop.wallpapers();
      if (!Array.isArray(wallpapers) || !wallpapers.length) throw new Error('Imported wallpaper could not be rendered');
      Log.info('KOYA_WALLPAPER_READY');
    }
    catch (error) { Log.error('Could not prepare the installed wallpaper: ' + error); }
    finally { Engine.quit(); }
  }, 0);
}
