import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import threading
import uuid
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from django.conf import settings
from django.http import JsonResponse
from django.db import transaction
from .db import one, query, encoded

class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1)
password_slots = threading.BoundedSemaphore(4)
dummy_hash = hasher.hash(secrets.token_hex(32))
cookie_name = '__Host-clarity' if settings.PRODUCTION else 'clarity_session'
safe_keys = ('id','username','full_name','email','role','active','must_change_password','created_at','updated_at')
def safe_user(user):
    return {k: user[k] for k in safe_keys}
def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()
def password_hash(value):
    if not password_slots.acquire(blocking=False):
        raise ApiError(429, 'Authentication is busy. Please retry shortly.')
    try:
        return hasher.hash(value)
    finally:
        password_slots.release()
def password_verify(stored, value):
    if not password_slots.acquire(blocking=False):
        raise ApiError(429, 'Authentication is busy. Please retry shortly.')
    try:
        # node-argon2 also emits m,p,t order. libargon2's Python decoder requires
        # m,t,p; reordering encoded metadata preserves salt/hash and existing accounts.
        parts=stored.split('$')
        if len(parts)==6 and parts[1]=='argon2id':
            parameters=dict(item.split('=',1) for item in parts[3].split(','))
            if set(parameters)=={'m','t','p'}:
                parts[3]=','.join(key+'='+parameters[key] for key in ('m','t','p'))
                stored='$'.join(parts)
        return hasher.verify(stored, value)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    finally:
        password_slots.release()
def password_policy(value, username=''):
    if not isinstance(value,str) or not 6 <= len(value) <= 128 or len(value.strip()) < 6:
        raise ApiError(400, 'Use a password or passphrase of 6–128 characters.')
    if re.match(r'^(password|qwerty|letmein|123456|admin)', value, re.I) or len(set(value)) == 1 or len(username)>3 and username.lower() in value.lower():
        raise ApiError(400, 'Choose a less predictable password without your username.')
def read_json(request, limit=16384):
    if len(request.body)>limit:
        raise ApiError(413, 'Request is too large.')
    try:
        data=json.loads(request.body)
        if not isinstance(data,dict):
            raise ValueError()
        return data
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, 'Invalid JSON request.')
def client_ip(request):
    peer=request.META.get('REMOTE_ADDR','').removeprefix('::ffff:')
    forwarded=request.headers.get('X-Forwarded-For','')
    mode=os.getenv('TRUST_PROXY')
    candidate=forwarded.split(',')[-1].strip() if mode=='alb' else forwarded if mode=='loopback' and peer in ('127.0.0.1','::1') else peer
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return peer or None
def audit(request, actor, action, module, record_id=None, metadata=None):
    actor=actor or {}
    safe={k:v for k,v in (metadata or {}).items() if k in ('fields','page','field','status','role','active','reason','format','count')}
    query('INSERT INTO audit_logs(actor_id,actor_username,actor_role,action,module,record_id,metadata,request_id,ip_address) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)',
          [actor.get('id'),actor.get('username'),actor.get('role'),action,module,str(record_id) if record_id else None,encoded(safe),request.request_id,client_ip(request)])
def identify(request):
    token=request.COOKIES.get(cookie_name,'')
    if not re.fullmatch('[a-f0-9]{64}',token):
        return None
    user=one("SELECT u.*,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>now() AND s.last_seen_at>now()-interval '30 minutes' AND u.active",[digest(token)])
    if user:
        query("UPDATE sessions SET last_seen_at=now() WHERE token_hash=%s AND last_seen_at<now()-interval '1 minute'",[digest(token)])
        user['csrf']=digest('csrf:'+token)
    return user
def origin_check(request):
    if request.headers.get('Origin') != settings.APP_ORIGIN:
        raise ApiError(403,'Request origin is not allowed.')
def require_user(request, allow_password_change=False, admin=False):
    user=identify(request)
    if not user:
        raise ApiError(401,'Please sign in.')
    if user['must_change_password'] and not allow_password_change:
        raise ApiError(403,'PASSWORD_CHANGE_REQUIRED')
    if admin and user['role']!='admin':
        raise ApiError(403,'Administrator access required.')
    if request.method not in ('GET','HEAD'):
        origin_check(request)
        if not hmac.compare_digest(request.headers.get('X-CSRF-Token','').encode(),user['csrf'].encode()):
            raise ApiError(403,'Security token expired. Reload this page.')
    return user
def new_session(user):
    token=secrets.token_hex(32)
    query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(%s,%s,now()+interval '8 hours')",[digest(token),user['id']])
    return token
def session_response(data, token, max_age=28800):
    response=JsonResponse(data)
    response.set_cookie(cookie_name,token,max_age=max_age,httponly=True,samesite='Strict',secure=settings.PRODUCTION,path='/')
    return response
def rate_limit(key):
    return one("INSERT INTO login_limits(key,attempts) VALUES(%s,1) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN login_limits.window_started<now()-interval '15 minutes' THEN 1 ELSE login_limits.attempts+1 END,window_started=CASE WHEN login_limits.window_started<now()-interval '15 minutes' THEN now() ELSE login_limits.window_started END RETURNING attempts",[key])['attempts']
def auth(request, action):
    if action=='login' and request.method=='POST':
        origin_check(request)
        body=read_json(request)
        username=body.get('username','')
        username=username.strip().lower() if isinstance(username,str) else ''
        password=body.get('password')
        if not re.fullmatch('[a-z0-9][a-z0-9._-]{2,63}',username) or not isinstance(password,str) or len(password)>128:
            raise ApiError(400,'Enter a valid username and password.')
        with transaction.atomic():
            ip_count=rate_limit('ip:'+digest(client_ip(request) or ''))
            user_count=rate_limit('user:'+digest(username))
        if ip_count>100 or user_count>10:
            audit(request,{'username':username},'login_failed','authentication',metadata={'reason':'rate_limited'})
            raise ApiError(429,'Too many attempts. Try again in 15 minutes.')
        user=one('SELECT * FROM users WHERE username=%s',[username])
        valid=password_verify(user['password_hash'] if user else dummy_hash,password)
        if not valid or not user or not user['active']:
            audit(request,{'username':username},'login_failed','authentication',metadata={'reason':'invalid_credentials'})
            raise ApiError(401,'Invalid username or password.')
        with transaction.atomic():
            locked=one('SELECT * FROM users WHERE id=%s FOR UPDATE',[user['id']])
            if not locked['active'] or locked['password_hash']!=user['password_hash']:
                raise ApiError(401,'Invalid username or password.')
            query('DELETE FROM sessions WHERE token_hash=%s',[digest(request.COOKIES.get(cookie_name,''))])
            token=new_session(locked)
            audit(request,locked,'admin_login' if locked['role']=='admin' else 'user_login','authentication',locked['id'])
        return session_response({'user':safe_user(locked),'csrf':digest('csrf:'+token)},token)
    user=require_user(request,allow_password_change=True)
    if action=='me' and request.method=='GET':
        return JsonResponse({'user':safe_user(user),'csrf':user['csrf']})
    if action=='logout' and request.method=='POST':
        with transaction.atomic():
            query('DELETE FROM sessions WHERE token_hash=%s',[user['token_hash']])
            audit(request,user,'logout','authentication',user['id'])
        return session_response({'ok':True},'',0)
    if action=='password' and request.method=='POST':
        if rate_limit('change:'+str(user['id']))>10:
            raise ApiError(429,'Too many password change attempts. Try again in 15 minutes.')
        body=read_json(request)
        value=body.get('newPassword')
        password_policy(value,user['username'])
        if value!=body.get('confirmPassword'):
            raise ApiError(400,'New passwords do not match.')
        current=body.get('currentPassword')
        if not isinstance(current,str) or len(current)>128:
            raise ApiError(400,'Enter the current password.')
        with transaction.atomic():
            account=one('SELECT * FROM users WHERE id=%s FOR UPDATE',[user['id']])
            if not password_verify(account['password_hash'],current):
                raise ApiError(400,'Current password is incorrect.')
            if password_verify(account['password_hash'],value) or value==os.getenv('TEMPORARY_PASSWORD'):
                raise ApiError(400,'Choose a new password different from the temporary or current password.')
            query('UPDATE users SET password_hash=%s,must_change_password=false,password_changed_at=now(),updated_at=now() WHERE id=%s',[password_hash(value),user['id']])
            query('DELETE FROM sessions WHERE user_id=%s',[user['id']])
            token=new_session(user)
            audit(request,user,'password_changed','authentication',user['id'])
        return session_response({'ok':True,'csrf':digest('csrf:'+token)},token)
    raise ApiError(404,'Authentication endpoint not found.')
