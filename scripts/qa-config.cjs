const path=require('node:path');
const result=require('dotenv').config({path:path.resolve(__dirname,'../.env.qa'),override:true,quiet:true});
if(result.error)throw Error('QA configuration missing. Create an isolated .env.qa; never run infrastructure tests against live data.');
const url=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/(clarity_portal|[a-z0-9_]+_qa)$/.test(url.pathname)||process.env.APP_ORIGIN!=='http://127.0.0.1:4318')throw Error('Refusing tests: configuration is not the isolated local QA database and port.');
