import re
import uuid
from datetime import date
from django.http import JsonResponse
from django.db import transaction
from .db import one, query, decoded
from .security import ApiError, read_json, safe_user, password_hash, password_policy, audit
import os

def pagination(request):
    try:
        page=int(request.GET.get('page') or 1)
        size=int(request.GET.get('size') or 20)
        if not 1<=page<=100000 or not 1<=size<=100:
            raise ValueError()
        return page,size,(page-1)*size
    except ValueError:
        raise ApiError(400,'Invalid pagination.')
def account_input(body):
    clean={k:body.get(k,'').strip() if isinstance(body.get(k,''),str) else '' for k in ('username','full_name','email')}
    clean['username']=clean['username'].lower()
    if not re.fullmatch('[a-z0-9][a-z0-9._-]{2,63}',clean['username']):
        raise ApiError(400,'Username must contain 3–64 letters, numbers, dots, underscores or hyphens.')
    if not 1<=len(clean['full_name'])<=120 or re.search(r'[\x00-\x1f]',clean['full_name']):
        raise ApiError(400,'Enter a full name of 1–120 characters.')
    if len(clean['email'])>254 or clean['email'] and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',clean['email']):
        raise ApiError(400,'Enter a valid email address or leave it blank.')
    if body.get('role') not in ('user','admin') or type(body.get('active')) is not bool:
        raise ApiError(400,'Choose a valid role and account status.')
    return {**clean,'role':body['role'],'active':body['active']}
def temporary_hash():
    value=os.getenv('TEMPORARY_PASSWORD')
    if not value:
        raise ApiError(503,'Temporary password is not configured. Contact the server operator.')
    password_policy(value)
    return password_hash(value)
def accounts(request,actor,route):
    if route=='stats' and request.method=='GET':
        counts=one("SELECT count(*)::int AS total,count(*) FILTER(WHERE active)::int AS active,count(*) FILTER(WHERE NOT active)::int AS inactive,count(*) FILTER(WHERE created_at>now()-interval '7 days')::int AS recent FROM users")
        counts.update(one("SELECT count(*)::int AS events_today FROM audit_logs WHERE created_at>=date_trunc('day',now())"))
        counts['recentUsers']=query('SELECT id,username,full_name,role,active,created_at FROM users ORDER BY created_at DESC,id LIMIT 5')
        return JsonResponse(counts)
    if route=='audit':
        if request.method!='GET':
            raise ApiError(405,'Audit history is read-only.')
        return activity(request)
    if route=='users' and request.method=='GET':
        page,size,offset=pagination(request)
        role=request.GET.get('role',''); active=request.GET.get('active','')
        if role and role not in ('admin','user') or active and active not in ('true','false'):
            raise ApiError(400,'Invalid filter.')
        search='%'+request.GET.get('q','')[:120]+'%'
        params=[search,search,search,role,role,active,active]
        where="WHERE (username ILIKE %s OR full_name ILIKE %s OR email ILIKE %s) AND (%s='' OR role=%s) AND (%s='' OR active::text=%s)"
        total=one('SELECT count(*) FROM users '+where,params)['count']
        rows=query('SELECT id,username,full_name,email,role,active,must_change_password,created_at,updated_at FROM users '+where+' ORDER BY created_at DESC,id LIMIT %s OFFSET %s',params+[size,offset])
        return JsonResponse({'rows':rows,'total':total,'page':page,'size':size})
    if route=='users' and request.method=='POST':
        body=account_input(read_json(request)); hashed=temporary_hash(); user_id=uuid.uuid4()
        with transaction.atomic():
            user=one('INSERT INTO users(id,username,full_name,email,role,active,password_hash) VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING *',[user_id,*body.values(),hashed])
            audit(request,actor,'user_created','users',user_id,{'role':body['role'],'active':body['active']})
        return JsonResponse({'user':safe_user(user)},status=201)
    match=re.fullmatch(r'users/([a-f0-9-]{36})(/reset-password)?',route)
    if match:
        try:
            user_id=uuid.UUID(match[1])
        except ValueError:
            raise ApiError(404,'User not found.')
        if request.method=='GET' and not match[2]:
            user=one('SELECT * FROM users WHERE id=%s',[user_id])
            if not user: raise ApiError(404,'User not found.')
            return JsonResponse({'user':safe_user(user)})
        if request.method=='PATCH' and not match[2]:
            body=account_input(read_json(request))
            with transaction.atomic():
                query('SELECT pg_advisory_xact_lock(4317003)')
                old=one('SELECT * FROM users WHERE id=%s FOR UPDATE',[user_id])
                if not old: raise ApiError(404,'User not found.')
                if actor['id']==user_id and (not body['active'] or body['role']!='admin'):
                    raise ApiError(409,'You cannot deactivate or demote your own account.')
                if old['role']=='admin' and old['active'] and (not body['active'] or body['role']!='admin') and one("SELECT count(*) FROM users WHERE role='admin' AND active")['count']<=1:
                    raise ApiError(409,'Keep at least one active administrator.')
                user=one('UPDATE users SET username=%s,full_name=%s,email=%s,role=%s,active=%s,updated_at=now() WHERE id=%s RETURNING *',[*body.values(),user_id])
                if not body['active'] or body['role']!=old['role']:
                    query('DELETE FROM sessions WHERE user_id=%s',[user_id])
                audit(request,actor,'user_updated','users',user_id,{'fields':[k for k in body if body[k]!=old[k]]})
                if body['active']!=old['active']:
                    audit(request,actor,'user_activated' if body['active'] else 'user_deactivated','users',user_id,{'active':body['active']})
                if body['role']!=old['role']:
                    audit(request,actor,'role_changed','users',user_id,{'role':body['role']})
            return JsonResponse({'user':safe_user(user)})
        if request.method=='POST' and match[2]:
            if actor['id']==user_id: raise ApiError(409,'Use your own Change password screen.')
            hashed=temporary_hash()
            with transaction.atomic():
                user=one('UPDATE users SET password_hash=%s,must_change_password=true,password_changed_at=now(),updated_at=now() WHERE id=%s RETURNING id',[hashed,user_id])
                if not user: raise ApiError(404,'User not found.')
                query('DELETE FROM sessions WHERE user_id=%s',[user_id])
                audit(request,actor,'password_reset','users',user_id)
            return JsonResponse({'ok':True})
    raise ApiError(404,'Administrative endpoint not found.')
def activity(request):
    page,size,offset=pagination(request)
    start=request.GET.get('from') or None; end=request.GET.get('to') or None
    try:
        for value in (start,end):
            if value and (not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value) or date.fromisoformat(value).isoformat()!=value): raise ValueError()
    except ValueError:
        raise ApiError(400,'Invalid date filter.')
    if start and end and start>end: raise ApiError(400,'Start date must be before end date.')
    search='%'+request.GET.get('q','')[:120]+'%'
    params=[search,search,search]
    where="WHERE (coalesce(actor_username,'') ILIKE %s OR action ILIKE %s OR coalesce(record_id,'') ILIKE %s)"
    for key,column,limit in [('user','actor_username',64),('action','action',64),('module','module',32)]:
        value=request.GET.get(key,'')[:limit]
        if value: where+=' AND '+column+'=%s'; params.append(value)
    if start: where+=" AND created_at >= %s::date AT TIME ZONE 'UTC'"; params.append(start)
    if end: where+=" AND created_at < (%s::date+interval '1 day') AT TIME ZONE 'UTC'"; params.append(end)
    total=one('SELECT count(*) FROM audit_logs '+where,params)['count']
    rows=query('SELECT * FROM audit_logs '+where+' ORDER BY created_at DESC,id DESC LIMIT %s OFFSET %s',params+[size,offset])
    for row in rows: row['metadata']=decoded(row['metadata'])
    return JsonResponse({'rows':rows,'total':total,'page':page,'size':size})
