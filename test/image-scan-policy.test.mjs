import test from 'node:test';
import assert from 'node:assert/strict';
import {imageScanGate} from '../scripts/image-scan-policy.mjs';
const report=findings=>({Metadata:{OS:{Family:'wolfi'}},Results:[{Class:'os-pkgs',Packages:[{Name:'glibc'}],Vulnerabilities:findings}]});
test('release gate blocks high/critical findings and retains lower-severity visibility',()=>{
 assert.equal(imageScanGate(report([])).status,'PASS');
 const r=imageScanGate(report([{Severity:'HIGH'},{Severity:'CRITICAL'},{Severity:'MEDIUM'}]));
 assert.equal(r.status,'BLOCKED');assert.deepEqual(r.counts,{CRITICAL:1,HIGH:1,MEDIUM:1,LOW:0,UNKNOWN:0});
});
test('failed or incomplete scans cannot become passing release reports',()=>{
 for(const r of [{},{Metadata:{OS:{}},Results:[]},{Metadata:{OS:{Family:'wolfi'}},Results:[{Class:'os-pkgs',Packages:[]}]},report('error'),report([{Severity:'unexpected'}])])assert.throws(()=>imageScanGate(r));
});
