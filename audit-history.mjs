import {pagination} from './admin.mjs';
import {HttpError} from './security.mjs';
export async function handleAudit(req,res,url,actor,pool,json){
 if(url.pathname!=='/api/admin/audit')return false;
 if(actor.role!=='admin')throw new HttpError(403,'Administrator access required.');
 if(req.method!=='GET')throw new HttpError(405,'Audit history is read-only.');
 const {page,size,offset}=pagination(url),p=url.searchParams;
 const q=(p.get('q')||'').slice(0,120),user=(p.get('user')||'').slice(0,64),action=(p.get('action')||'').slice(0,64),module=(p.get('module')||'').slice(0,32),from=p.get('from')||null,to=p.get('to')||null;
 for(const d of [from,to])if(d&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw new HttpError(400,'Invalid date filter.');
 if(from&&to&&from>to)throw new HttpError(400,'Start date must be before end date.');
 const values=['%'+q+'%',user,action,module,from,to];
 const where="WHERE (coalesce(actor_username,'') ILIKE $1 OR action ILIKE $1 OR coalesce(record_id,'') ILIKE $1) AND ($2='' OR actor_username=$2) AND ($3='' OR action=$3) AND ($4='' OR module=$4) AND ($5::date IS NULL OR created_at >= $5::date AT TIME ZONE 'UTC') AND ($6::date IS NULL OR created_at < ($6::date + interval '1 day') AT TIME ZONE 'UTC')";
 const total=Number((await pool.query('SELECT count(*) FROM audit_logs '+where,values)).rows[0].count);
 const rows=(await pool.query('SELECT * FROM audit_logs '+where+' ORDER BY created_at DESC,id DESC LIMIT $7 OFFSET $8',[...values,size,offset])).rows;
 json(res,200,{rows,total,page,size});return true;
}
