// Runs only existing isolated-QA suites. Each result is retained even on failure.
const {spawnSync}=require('node:child_process'),fs=require('node:fs');
const groups={
 accounts:['test-auth.mjs','test-users.mjs','test-audit.mjs','test-security.mjs','test-users-browser.cjs','test-list-error-recovery.cjs','test-user-pagination.cjs','test-xss.cjs','test-password-eyes.cjs','test-navigation.cjs','test-activity-ui.cjs','test-document-list-recovery.cjs'],
 reader:['test-reader-controls.cjs','test-demo-resilience.cjs','test-export-dropdown.cjs','test-portal-dates.cjs','test-confirmations.cjs','test-isolation.mjs','test-ui.cjs','test-branding.cjs'],
 recovery:['test-cancel-browser.cjs','test-recovery.mjs']
};
const group=process.argv[2];if(!groups[group])throw Error('Choose accounts, reader, or recovery');
fs.mkdirSync('output/full-verification',{recursive:true});const selected=process.argv.slice(3),report='output/full-verification/'+group+'.json';
if(selected.some(name=>!groups[group].includes(name)))throw Error('Test is not in the selected group');
const results=selected.length&&fs.existsSync(report)?JSON.parse(fs.readFileSync(report)):[];
for(const name of selected.length?selected:groups[group]){const start=Date.now();const run=spawnSync(process.execPath,['scripts/'+name],{encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:8*1024*1024});const output=(run.stdout||'')+(run.stderr||'');fs.writeFileSync('output/full-verification/'+name+'.log',output);const result={test:name,passed:run.status===0,seconds:Math.round((Date.now()-start)/1000),error:run.error?.message};const index=results.findIndex(r=>r.test===name);if(index<0)results.push(result);else results[index]=result;console.log((result.passed?'PASS ':'FAIL ')+name);if(!result.passed)console.log(output.slice(-1800));fs.writeFileSync(report,JSON.stringify(results,null,2));}
if(results.some(r=>!r.passed))process.exitCode=1;
