import * as Assets from 'Koya/Assets';
import * as Log from 'Helix/Log';
import * as Process from 'Module/process';

// Koya indexes every file under a mount source, so the checkout is never
// mounted whole (its .work/ holds build trees and caches). run.sh mounts this
// directory; the installer's own directories are mounted here at their paths.
export default function main() {
  setTimeout(async () => {
    try {
      const root = Process.getEnv('KOYA_INSTALLER_ROOT', '');
      const selfTest = Process.getEnv('KOYA_INSTALLER_SELF_TEST', '') === '1';
      for (const directory of ['apps', 'assets', ...(selfTest ? ['tests'] : [])])
        await Assets.mount(root + '/' + directory, '/rom/' + directory);
      if (selfTest) (await import('/rom/tests/preview.js')).default();
      else await (await import('/rom/apps/installer.js')).installer();
    } catch (error) { Log.error('Installer: ' + error); }
  }, 0);
}
