import 'dotenv/config';
import pg from 'pg';
import {databaseOptions} from '../deployment-config.mjs';
export function createPool(connectionString=process.env.DATABASE_URL){
 if(!connectionString)throw Error('DATABASE_URL is required. See docs/DATABASE_DESIGN.md.');
 const pool=new pg.Pool(databaseOptions(connectionString));
 pool.on('error',()=>console.error('Database connection interrupted'));
 return pool;
}
export async function transaction(pool,work){
 const client=await pool.connect();
 try{await client.query('BEGIN');const result=await work(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
 finally{client.release();}
}
export function databaseError(error){
 if(error.code==='23505')return {status:409,error:'An account with that username already exists.'};
 if(['23503','23514','22P02'].includes(error.code))return {status:400,error:'Invalid record data.'};
 return {status:503,error:'The database is temporarily unavailable. Please retry.'};
}
