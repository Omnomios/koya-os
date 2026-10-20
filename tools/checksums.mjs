import fs from 'node:fs';
import crypto from 'node:crypto';
const root=new URL('../payload/',import.meta.url).pathname;
const files=path=>fs.readdirSync(root+path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path+entry.name+'/'):entry.isFile()?[path+entry.name]:[]);
fs.writeFileSync(root+'SHA256SUMS',files('').filter(name=>name!=='SHA256SUMS').sort().map(name=>crypto.createHash('sha256').update(fs.readFileSync(root+name)).digest('hex')+'  '+name).join('\n')+'\n');
