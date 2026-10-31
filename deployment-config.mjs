import {readFileSync} from 'node:fs';
import {isIP} from 'node:net';

export function serverConfig(env=process.env) {
 const port=Number(env.PORT||4317),host=env.HOST||'127.0.0.1';
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be between 1 and 65535.');
 if(!isIP(host)&&host!=='localhost')throw Error('HOST must be an IP address or localhost.');
 const origin=env.APP_ORIGIN||`http://127.0.0.1:${port}`;
 let parsed;try{parsed=new URL(origin);}catch{throw Error('APP_ORIGIN must be an absolute origin.');}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.origin!==origin)throw Error('APP_ORIGIN must be an exact HTTP(S) origin without a path or trailing slash.');
 if(env.NODE_ENV==='production'&&parsed.protocol!=='https:')throw Error('Production APP_ORIGIN must use HTTPS.');
 if(env.TRUST_PROXY&&!['loopback','alb'].includes(env.TRUST_PROXY))throw Error('TRUST_PROXY must be loopback or alb.');
 return {port,host,origin};
}

export function databaseOptions(connectionString,env=process.env) {
 if(!connectionString)throw Error('DATABASE_URL is required. See docs/DATABASE_DESIGN.md.');
 let url;try{url=new URL(connectionString);}catch{throw Error('DATABASE_URL must be a valid PostgreSQL URL.');}
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('DATABASE_URL must be a PostgreSQL URL.');
 const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 const verified=env.DATABASE_SSL_MODE==='verify-full';
 if(env.DATABASE_SSL_MODE&&!['verify-full','disable'].includes(env.DATABASE_SSL_MODE))throw Error('DATABASE_SSL_MODE must be verify-full or disable.');
 if(env.NODE_ENV==='production'&&!local&&!verified)throw Error('Remote production PostgreSQL requires DATABASE_SSL_MODE=verify-full.');
 let ssl;
 if(verified){
  if(!env.DATABASE_SSL_CA_FILE)throw Error('DATABASE_SSL_CA_FILE is required for verified database TLS.');
  // pg connection-string SSL options can override the SSL object. Reject rather than downgrade.
  if([...url.searchParams.keys()].some(k=>k.toLowerCase().startsWith('ssl')))throw Error('Remove SSL query parameters from DATABASE_URL; use DATABASE_SSL_MODE and DATABASE_SSL_CA_FILE.');
  ssl={ca:readFileSync(env.DATABASE_SSL_CA_FILE,'utf8'),rejectUnauthorized:true};
 }
 const max=Number(env.DATABASE_POOL_SIZE||10);
 if(!Number.isInteger(max)||max<2||max>50)throw Error('DATABASE_POOL_SIZE must be between 2 and 50.');
 return {connectionString,max,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:15000,...(ssl?{ssl}:{})};
}

export function clientAddress(req,mode=process.env.TRUST_PROXY) {
 const peer=req.socket.remoteAddress?.replace('::ffff:','')||null;
 const forwarded=req.headers['x-forwarded-for'];
 if(typeof forwarded!=='string')return peer;
 if(mode==='loopback'&&['127.0.0.1','::1'].includes(peer)&&isIP(forwarded))return forwarded;
 // ALB append mode puts its observed client IP LAST. Never trust a supplied first entry.
 // Enable ONLY when the task security group accepts traffic exclusively from the ALB.
 if(mode==='alb'){
  const last=forwarded.split(',').at(-1).trim();
  if(isIP(last))return last;
 }
 return peer;
}
