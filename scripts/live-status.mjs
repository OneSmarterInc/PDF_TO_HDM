// Read-only operational check; never prints credentials or document contents.
import 'dotenv/config';
import {createPool} from '../db/index.mjs';
const pool=createPool();
try{const result=await pool.query("SELECT count(*)::int AS active FROM documents WHERE status IN ('queued','processing') AND expires_at>now()");console.log(JSON.stringify({activeJobs:result.rows[0].active}));if(result.rows[0].active)process.exitCode=2;}finally{await pool.end();}
