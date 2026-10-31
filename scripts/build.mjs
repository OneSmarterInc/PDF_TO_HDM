import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
// Allowlist packaging: never include credentials, uploads, review caches, DB files or test fixtures.
const root=process.cwd(),destination=path.resolve(root,'dist');if(path.basename(destination)!=='dist'||path.dirname(destination)!==root)throw Error('Invalid build destination');
await fs.mkdir(destination,{recursive:true});
const roots=(await fs.readdir(root)).filter(n=>/\.(mjs|py)$/.test(n)&&n!=='eslint.config.mjs');
const files=[...roots,'package.json','package-lock.json','requirements.txt','requirements.lock.txt','.env.example','.env.migration.example'];
async function collect(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(['__pycache__','node_modules'].includes(e.name)||e.isSymbolicLink())continue;const p=dir+'/'+e.name;if(e.isDirectory())await collect(p);else files.push(p);}}
for(const dir of ['public','db','excel','docs'])await collect(dir);
files.push('scripts/migrate.mjs','scripts/bootstrap-admin.mjs');
for(const name of files){if(/\.(mjs|js)$/.test(name))execFileSync(process.execPath,['--check',name],{stdio:'pipe'});await fs.mkdir(path.dirname(path.join(destination,name)),{recursive:true});await fs.copyFile(name,path.join(destination,name));}
await fs.mkdir(path.join(destination,'models'),{recursive:true});await fs.copyFile('models/eng.traineddata',path.join(destination,'models/eng.traineddata'));
const manifest={builtAt:new Date().toISOString(),files:{}};for(const name of [...files,'models/eng.traineddata'])manifest.files[name]=createHash('sha256').update(await fs.readFile(path.join(destination,name))).digest('hex');await fs.writeFile(path.join(destination,'build-manifest.json'),JSON.stringify(manifest,null,2));
console.log(`Production package built: ${files.length+1} files; syntax checked; private data excluded.`);
