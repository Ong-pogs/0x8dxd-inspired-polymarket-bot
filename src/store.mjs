import fs from 'node:fs';import path from 'node:path';
export function persist(file,state){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.pending';fs.writeFileSync(temp,JSON.stringify(state,null,2));fs.renameSync(temp,file);}
export function acquire(file){fs.mkdirSync(path.dirname(file),{recursive:true});let fd;try{fd=fs.openSync(file,'wx');}catch{throw Error('Runner lock exists; stop the other process before continuing');}fs.writeFileSync(fd,String(process.pid));return()=>{fs.closeSync(fd);fs.unlinkSync(file);};}
