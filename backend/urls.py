import logging
from django.urls import re_path
from django.http import JsonResponse, HttpResponse, HttpResponseRedirect
from django.conf import settings
from django.db import DatabaseError
from django.core.exceptions import RequestDataTooBig
from .security import ApiError, auth, require_user, identify
from .accounts import accounts
from .documents import documents
from .db import one

def dispatch(request,path=''):
    try:
        if path=='healthz':
            one('SELECT 1'); return JsonResponse({'status':'ok','backend':'django'})
        if path.startswith('api/auth/'):
            return auth(request,path.removeprefix('api/auth/'))
        if path.startswith('api/'):
            actor=require_user(request,admin=path.startswith('api/admin/'))
            if path.startswith('api/admin/'):
                return accounts(request,actor,path.removeprefix('api/admin/'))
            if path=='api/documents' or path.startswith('api/documents/'):
                return documents(request,actor,path.removeprefix('api/documents').lstrip('/'))
            raise ApiError(404,'Not found')
        if request.method not in ('GET','HEAD'): raise ApiError(405,'Method not allowed')
        if path in ('','portal','documents','change-password','admin','admin/users','admin/audit','login'):
            if path!='login':
                user=identify(request)
                if not user: return HttpResponseRedirect('/login')
                if user['must_change_password'] and path!='change-password': return HttpResponseRedirect('/change-password')
                if path.startswith('admin') and user['role']!='admin': return HttpResponseRedirect('/portal')
            index=settings.ROOT/'frontend'/'dist'/'index.html'
            if not index.exists(): raise ApiError(503,'Frontend is not built. Run npm run build:frontend.')
            return HttpResponse(index.read_bytes(),content_type='text/html')
        raise ApiError(404,'Not found')
    except ApiError as error:
        return JsonResponse({'error':error.message},status=error.status)
    except RequestDataTooBig:
        return JsonResponse({'error':'Maximum PDF size is 30 MB.'},status=413)
    except DatabaseError as error:
        code=getattr(error.__cause__,'sqlstate',None)
        if code=='23505': return JsonResponse({'error':'An account with that username already exists.'},status=409)
        if code in ('23503','23514','22P02'): return JsonResponse({'error':'Invalid record data.'},status=400)
        logging.exception('Database request failed: %s',request.request_id)
        return JsonResponse({'error':'The database is temporarily unavailable.'},status=503)
    except Exception:
        logging.exception('Request failed: %s',request.request_id)
        return JsonResponse({'error':'The request could not be completed.'},status=500)

urlpatterns=[re_path(r'^(?P<path>.*)$',dispatch)]
