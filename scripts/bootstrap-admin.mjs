import 'dotenv/config';import {randomUUID} from 'node:crypto';
import {createPool,transaction} from '../db/index.mjs';import {passwordHash,passwordPolicy,audit} from '../security.mjs';
const pool=createPool();
try{const username=process.env.BOOTSTRAP_USERNAME,password=process.env.BOOTSTRAP_PASSWORD;
 if(!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username||''))throw Error('Set BOOTSTRAP_USERNAME.');passwordPolicy(password,username);
 await transaction(pool,async c=>{await c.query('SELECT pg_advisory_xact_lock(4317002)');if((await c.query("SELECT 1 FROM users WHERE role='admin'")).rowCount)throw Error('An administrator already exists; bootstrap will not replace it.');const id=randomUUID();await c.query("INSERT INTO users(id,username,full_name,role,password_hash) VALUES($1,$2,'Portal administrator','admin',$3)",[id,username,await passwordHash(password)]);await audit(c,{id,username,role:'admin'},'admin_initialized','users',id);});console.log('Administrator initialized. First-login password change required.');
}finally{await pool.end();}
