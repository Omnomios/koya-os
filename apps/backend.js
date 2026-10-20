import * as Process from 'Module/process';
import { eventStream, frame, emptySecrets } from './model.js';
import { mockBackend } from './mock.js';
const root = Process.getEnv('KOYA_INSTALLER_ROOT', '.');
export const preview = Process.getEnv('KOYA_INSTALLER_PREVIEW', '') === '1';
// `codes` are the exit statuses that still carry a result on stdout.
const execute = (cmd, args, codes = [0]) => new Promise((resolve, reject) => {
  const child = Process.spawn({ cmd, args });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error = (error + chunk).slice(-8192); });
  child.on('exit', code => codes.includes(code) ? resolve(output) : reject(new Error(error.trim() || 'The command could not complete')));
});
export function backend() {
  // Preview runs against fixtures; nothing below it is reached.
  if (preview) return mockBackend();
  let child, busy = false;
  return {
    async disks() {
      return JSON.parse(await execute(root + '/backend/install.sh', ['--disks']));
    },
    // Every zone the system can use, with country, region and offset.
    async timezones() { return JSON.parse(await execute(root + '/backend/timezones.sh', [])); },
    async connection() {
      // network.sh exits 1 when offline (install.sh relies on that), but its
      // report on stdout is the answer either way.
      return JSON.parse(await execute(root + '/backend/network.sh', [], [0, 1]));
    },
    install(config, confirmation, secrets, receive) {
      if (busy) throw new Error('Installation is already running');
      busy = true;
      child=Process.spawn({cmd:'/usr/bin/pkexec',args:[root+'/backend/install.sh','--gui']});
      let finished=false,protocolError='';
      const read=eventStream(event=>{
        if(event.type==='ready') child.write(frame({type:'install',config,confirmation}));
        else if(event.type==='secret') {
          const value=event.message==='account_password'?secrets.password: event.message==='luks_passphrase'?secrets.luks:undefined;
          if(value===undefined) throw new Error('Unexpected credential request');
          child.write(frame({type:'secret',name:event.message,value}));
        } else if(event.type==='accepted') Object.assign(secrets,emptySecrets());
        else {if(['complete','error'].includes(event.type)){finished=true;busy=false;Object.assign(secrets,emptySecrets());}receive(event);}
      });
      child.stdout.on('data',chunk=>{try{read(chunk);}catch(_){protocolError='Installer communication failed';Object.assign(secrets,emptySecrets());child.closeStdin();child.kill();}});
      child.stderr.on('data',message=>receive({type:'log',message}));
      child.on('exit',code=>{
        Object.assign(secrets,emptySecrets());busy=false;
        if(!finished)receive({type:'error',message:protocolError||'Installer exited before completion (status '+code+'). See diagnostic output.'});
      });
    },
    async shutdown() { return execute('/usr/bin/systemctl',['poweroff']); }
  };
}
