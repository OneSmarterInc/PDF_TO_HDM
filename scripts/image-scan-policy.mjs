export function imageScanGate(report){
 if(!report?.Metadata?.OS?.Family||!Array.isArray(report.Results)||!report.Results.some(r=>r.Class==='os-pkgs'&&Array.isArray(r.Packages)&&r.Packages.length))throw Error('Incomplete vulnerability scan: OS inventory missing.');
 const counts={CRITICAL:0,HIGH:0,MEDIUM:0,LOW:0,UNKNOWN:0};
 for(const result of report.Results){
  if(result.Vulnerabilities!==undefined&&!Array.isArray(result.Vulnerabilities))throw Error('Invalid vulnerability results.');
  for(const finding of result.Vulnerabilities||[]){
   if(!Object.hasOwn(counts,finding.Severity))throw Error('Unrecognized vulnerability severity.');
   counts[finding.Severity]++;
  }
 }
 return {status:counts.HIGH+counts.CRITICAL?'BLOCKED':'PASS',counts};
}
