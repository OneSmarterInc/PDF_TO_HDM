require('./qa-config.cjs');
const {spawn}=require('node:child_process');
const child=spawn('.venv/Scripts/python.exe',['run_portal.py'],{stdio:'inherit',windowsHide:true,env:process.env});
child.on('exit',code=>process.exit(code||0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
