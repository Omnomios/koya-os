import * as Engine from 'Helix/Engine';
import * as Log from 'Helix/Log';
import * as Compositor from 'Koya/Compositor';
import * as Screenshot from 'Koya/Screenshot';
import * as Image from 'Koya/Image';
import * as UI from 'Helix/UserInterface';
import * as Process from 'Module/process';
import { installer } from '../apps/installer.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw new Error(message);};
const capture=async(win,name)=>{
 for(let i=0;i<20;i++){if(await Screenshot.capture(win,{id:name,source:'vulkan'})){
   const bytes=await Image.encode(win,{src:'/ram/screenshot/'+name,format:'png'});
   Process.writeFileText('/tmp/'+name+'.json',JSON.stringify(Array.from(new Uint8Array(bytes))));return;
  }await wait(50);}
 throw new Error('Preview screenshot was not ready');
};
export default function main(){setTimeout(async()=>{
 let app;
 const timer=setTimeout(()=>{Log.error('PREVIEW_TEST_FAIL: timeout');Engine.quit();},30000);
 try{
  app=await installer();const ui=globalThis.koyaInstallerPreview;
  assert(ui,'Preview fixture is required');
  await wait(800);await capture(app.win,'koya-installer-welcome');
  const at=name=>ui.state().page===name;
  assert(at('welcome'),'The live desktop opens the welcome screen');
  if(Process.getEnv('KOYA_INSTALLER_PREVIEW_TRY','')==='1') {
    Log.info('PREVIEW_TRY_READY');
    await wait(250);
    await ui.back();
    return;
  }
  await ui.next();assert(at('connect'),'Install starts the wizard');
  await ui.back();assert(at('welcome'),'Back returns to the welcome screen');
  await ui.next();assert(at('connect'),'The wizard can be reopened from welcome');
  await wait(250);await ui.next();assert(at('connect')&&ui.state().error,'Offline blocks continuing');
  await ui.connect('Koya Studio','wrong-password');assert(ui.state().error,'A wrong Wi-Fi password is refused');
  await ui.connect('Koya Studio','koya-preview');await ui.next();assert(at('disk'),'Connection page');
  await capture(app.win,'koya-installer-disks');
  ui.selectDisk('/dev/sda');await ui.next();assert(at('disk'),'Installer USB is blocked');
  ui.selectDisk('/dev/vda');await ui.next();assert(at('options'),'Disk selection');
  await capture(app.win,'koya-installer-options');
  // Encryption on (the default): the passphrase has its own page.
  await ui.next();assert(at('encryption'),'Encrypting asks for the passphrase on its own page');
  await capture(app.win,'koya-installer-encryption');
  await ui.next();assert(at('encryption')&&ui.state().error,'An empty passphrase is blocked');
  ui.fill({secrets:{luks:'fixture-passphrase',luksAgain:'different-passphrase'}});await ui.next();assert(at('encryption'),'Mismatched passphrases are blocked');
  ui.fill({secrets:{luksAgain:'fixture-passphrase'}});await ui.next();assert(at('account'),'Passphrase page');
  await capture(app.win,'koya-installer-account');
  await ui.back();assert(at('encryption'),'Back returns to the passphrase');
  await ui.back();assert(at('options'),'and to the options');
  // Encryption off: the passphrase page is skipped both ways.
  ui.fill({config:{encrypt:false,apps:[]}});
  await ui.next();assert(at('account'),'Without encryption there is no passphrase page');
  await ui.next();assert(at('account')&&ui.state().error,'Empty passwords are blocked');
  ui.fill({secrets:{password:'fixture-password',passwordAgain:'fixture-password'}});
  await ui.next();assert(at('review'),'Account page');
  const windowGeometry=async()=>{
    const info=await Compositor.getWindowInfo(app.win);
    return JSON.stringify([info.width,info.height,info.bufferScale,info.fractionalScale]);
  };
  const reviewGeometry=await windowGeometry();
  await capture(app.win,'koya-installer-review');
  await ui.next();assert(ui.state().installing,'Erase and install starts the installation');
  assert(await windowGeometry()===reviewGeometry,'Starting installation must preserve the window resolution and scale');
  await wait(300);await capture(app.win,'koya-installer-progress');
  assert(await windowGeometry()===reviewGeometry,'The progress page must preserve the window resolution and scale');
  for(let i=0;i<100&&!ui.state().done;i++)await wait(100);
  assert(ui.state().done&&!ui.state().failed,'Simulated installation completes');
  assert(await windowGeometry()===reviewGeometry,'Installation must not change the window resolution or scale');
  // An artificial resize is a separate, explicit check, never part of the
  // transition into the installation page.
  if(Process.getEnv('KOYA_INSTALLER_PREVIEW_RESIZE','')==='1') {
    Log.info('PREVIEW_RESIZE_TEST: requesting a 900 x 740 window');
    await Compositor.resizeWindow(app.win,900,740);await wait(300);
    const frame=await UI.getElementFrame(app.win,await UI.getElementById(app.win,'installer-panel'));
    assert(frame.max.x>frame.min.x&&frame.max.y>frame.min.y,'The panel must render after an explicit resize');
  }
  Log.info('PREVIEW_TEST_PASS');
 }catch(error){Log.error('PREVIEW_TEST_FAIL: '+error);if(error.stack)Log.error(error.stack);}
 // app.close() quits Koya at once: give the result line time to reach the
 // log first, or it can be lost and the run reads as neither pass nor fail.
 finally{clearTimeout(timer);await wait(250);await app?.close();setTimeout(()=>Engine.quit(),50);}
},0);}
