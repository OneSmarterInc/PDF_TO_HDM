import test from 'node:test';
import assert from 'node:assert/strict';
import {serverConfig,databaseOptions,clientAddress} from '../deployment-config.mjs';

test('deployment binds locally by default and requires exact HTTPS production origin',()=>{
 assert.deepEqual(serverConfig({}),{host:'127.0.0.1',port:4317,origin:'http://127.0.0.1:4317'});
 assert.equal(serverConfig({HOST:'0.0.0.0',NODE_ENV:'production',APP_ORIGIN:'https://pdf.example.com'}).host,'0.0.0.0');
 for(const APP_ORIGIN of ['http://pdf.example.com','https://pdf.example.com/','https://pdf.example.com/path','https://user:pass@pdf.example.com'])assert.throws(()=>serverConfig({NODE_ENV:'production',APP_ORIGIN}));
 assert.throws(()=>serverConfig({PORT:'0'}));assert.throws(()=>serverConfig({TRUST_PROXY:'true'}));
});
test('remote production database cannot silently disable TLS or certificate verification',()=>{
 const url='postgresql://app:example@db.example.com/portal';
 assert.throws(()=>databaseOptions(url,{NODE_ENV:'production'}),/verify-full/);
 assert.throws(()=>databaseOptions(url,{NODE_ENV:'production',DATABASE_SSL_MODE:'disable'}),/verify-full/);
 assert.throws(()=>databaseOptions(url,{DATABASE_SSL_MODE:'verify-full'}),/CA_FILE/);
 const env={NODE_ENV:'production',DATABASE_SSL_MODE:'verify-full',DATABASE_SSL_CA_FILE:'test/deployment-config.test.mjs'};
 assert.equal(databaseOptions(url,env).ssl.rejectUnauthorized,true);
 for(const query of ['sslmode=no-verify','sslmode=disable','sslrootcert=other.pem'])assert.throws(()=>databaseOptions(url+'?'+query,env),/Remove SSL/);
 assert.throws(()=>databaseOptions(url,{DATABASE_POOL_SIZE:'1'}));
 assert.equal(databaseOptions('postgresql://app:example@127.0.0.1/portal',{}).max,10);
});
test('proxy client address ignores spoofed first entries and defaults to peer',()=>{
 const req={socket:{remoteAddress:'::ffff:10.0.1.10'},headers:{'x-forwarded-for':'203.0.113.100, 198.51.100.23'}};
 assert.equal(clientAddress(req,''),'10.0.1.10');
 assert.equal(clientAddress(req,'loopback'),'10.0.1.10');
 assert.equal(clientAddress(req,'alb'),'198.51.100.23');
 req.headers['x-forwarded-for']='attacker';assert.equal(clientAddress(req,'alb'),'10.0.1.10');
 req.socket.remoteAddress='127.0.0.1';req.headers['x-forwarded-for']='198.51.100.23';assert.equal(clientAddress(req,'loopback'),'198.51.100.23');
});
