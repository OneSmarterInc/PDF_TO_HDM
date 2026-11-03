// Compatibility launcher. Django serves HTTP; Node performs internal OCR/export only.
import 'dotenv/config';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const local=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
const child=spawn(process.env.PYTHON_PATH||(existsSync(local)?local:'python'),[path.join(root,'run_portal.py')],{cwd:root,stdio:'inherit',env:process.env,windowsHide:true});
child.on('error',()=>{console.error('Could not start Django. Install requirements.lock.txt.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
