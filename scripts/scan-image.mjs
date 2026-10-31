import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {imageScanGate} from './image-scan-policy.mjs';

const image=process.argv[2];
if(!image||image.startsWith('-'))throw Error('Usage: node scripts/scan-image.mjs <image-tag-or-digest>');
const scanner='aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c';
const run=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:1200000,maxBuffer:64*1024*1024});
const dir=path.resolve('tmp','image-scan-'+randomUUID());
await fs.mkdir(dir,{recursive:true});await fs.mkdir('output',{recursive:true});
try{
 const imageId=run(['image','inspect','--format','{{.Id}}',image]).trim();
 const archive=path.join(dir,'image.tar');
 console.log('Exporting and scanning image without Docker socket access:',imageId);
 run(['save','--output',archive,image]);
 // Only the image archive and a dedicated public vulnerability-DB cache are exposed.
 const raw=run(['run','--rm','--mount',`type=bind,source=${archive},target=/scan/image.tar,readonly`,
  '--mount','type=volume,source=hdm-trivy-cache,target=/root/.cache',scanner,'image','--quiet','--timeout','15m',
  '--input','/scan/image.tar','--ignorefile','/dev/null','--scanners','vuln','--format','json']);
 const report=JSON.parse(raw);await fs.writeFile('output/image-security-scan.json',JSON.stringify(report,null,2));
 const {status,counts}=imageScanGate(report);
 const summary={image,imageId,scanner,scannedAt:new Date().toISOString(),status,counts,suppressions:0};
 await fs.writeFile('output/image-security-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
 if(status==='BLOCKED')process.exitCode=1;
}finally{
 // Delete only this invocation's generated archive directory, never user application data.
 await fs.rm(dir,{recursive:true,force:true});
}
