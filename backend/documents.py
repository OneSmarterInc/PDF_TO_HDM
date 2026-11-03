import hashlib
import re
import os
import uuid
from urllib.parse import unquote, quote
from django.http import JsonResponse, HttpResponse
from django.db import transaction
from .db import one, query, decoded, encoded
from .security import ApiError, read_json, audit
from .accounts import pagination
from . import worker

def document(row):
    data=decoded(row['result'])
    data.update(id=str(row['id']),name=row['name'],sha256=row['sha256'],status=row['status'],version=row['version'])
    return data
def documents(request,actor,suffix=''):
    if not suffix and request.method=='GET':
        page,size,offset=pagination(request)
        rows=query('SELECT id,name,status,created_at,expires_at FROM documents WHERE owner_id=%s AND expires_at>now() ORDER BY created_at DESC,id LIMIT %s OFFSET %s',[actor['id'],size,offset])
        total=one('SELECT count(*) FROM documents WHERE owner_id=%s AND expires_at>now()',[actor['id']])['count']
        return JsonResponse({'rows':rows,'total':total,'page':page,'size':size})
    if not suffix and request.method=='POST':
        data=request.body
        if len(data)>30*1024*1024: raise ApiError(413,'Maximum PDF size is 30 MB.')
        if b'%PDF-' not in data[:1024]: raise ApiError(400,'Choose a valid PDF file.')
        limit=int(os.getenv('MAX_QUEUED_DOCUMENTS','3')); hours=float(os.getenv('DOCUMENT_RETENTION_HOURS','2'))
        if not 1<=limit<=100 or not 1<=hours<=8760: raise ApiError(503,'Invalid document configuration.')
        job_id=str(uuid.uuid4()); name=unquote(request.headers.get('X-File-Name','Document.pdf'))[:200]
        checksum=hashlib.sha256(data).hexdigest()
        job={'id':job_id,'name':name,'sha256':checksum,'status':'queued','message':'Waiting to process…','pages':[],'completed':0,'total':0,'pageProgress':0}
        with transaction.atomic():
            query('SELECT pg_advisory_xact_lock(4317011)')
            count=one("SELECT count(*) FROM documents WHERE status IN ('queued','processing') AND expires_at>now()")['count']
            if count>=limit: raise ApiError(429,'The processing queue is full. Please try again shortly.')
            query("INSERT INTO documents(id,owner_id,name,sha256,status,result,expires_at) VALUES(%s,%s,%s,%s,'queued',%s,now()+%s*interval '1 hour')",[job_id,actor['id'],name,checksum,encoded(job),hours])
            query("INSERT INTO document_assets(document_id,name,data) VALUES(%s,'input.pdf',%s)",[job_id,data])
            audit(request,actor,'document_created','documents',job_id)
        try: worker.call('/jobs','POST',{'id':job_id,'ownerId':str(actor['id'])})
        except ApiError: pass  # Durable discovery picks up the upload after worker recovery.
        return JsonResponse({'id':job_id},status=202)
    match=re.fullmatch(r'([a-f0-9-]{36})(?:/(original\.pdf|page-\d+\.png|export\.xlsx|exports/(?:txt|json)))?',suffix)
    if not match: raise ApiError(404,'Document not found.')
    try: job_id=uuid.UUID(match[1])
    except ValueError: raise ApiError(404,'Document not found.')
    row=one('SELECT * FROM documents WHERE id=%s AND owner_id=%s AND expires_at>now()',[job_id,actor['id']])
    if not row: raise ApiError(404,'Document expired. Upload it again.')
    asset=match[2]
    if request.method=='DELETE' and not asset:
        # Lock the durable row before cancellation so discovery cannot resurrect it.
        with transaction.atomic():
            one('SELECT id FROM documents WHERE id=%s FOR UPDATE',[job_id])
            if row['status'] in ('queued','processing'):
                worker.call('/jobs/'+str(job_id),'DELETE')
            query('DELETE FROM documents WHERE id=%s AND owner_id=%s',[job_id,actor['id']])
            audit(request,actor,'document_deleted','documents',job_id,{'status':row['status']})
        return JsonResponse({'ok':True,'cancelled':True})
    if request.method=='PATCH' and not asset:
        return correct(request,actor,job_id)
    if asset and asset.startswith('exports/') and request.method=='POST':
        if row['status']!='complete': raise ApiError(404,'Document not found.')
        audit(request,actor,'document_exported','documents',job_id,{'format':asset.split('/')[1]})
        return JsonResponse({'ok':True})
    if request.method!='GET': raise ApiError(405,'Method not allowed')
    if asset=='export.xlsx':
        if row['status']!='complete': raise ApiError(409,'Wait for the PDF to finish processing.')
        data=document(row); data['includeRaw']=request.GET.get('raw')=='1'
        content=worker.call('/export','POST',data,binary=True,timeout=130)
        audit(request,actor,'document_exported','documents',job_id,{'format':'xlsx'})
        response=HttpResponse(content,content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        filename=re.sub(r'\.pdf$','',row['name'],flags=re.I)+'.xlsx'
        response['Content-Disposition']="attachment; filename=\"claims.xlsx\"; filename*=UTF-8''"+quote(filename,safe='')
        return response
    if asset:
        stored=one('SELECT data FROM document_assets WHERE document_id=%s AND name=%s',[job_id,'input.pdf' if asset=='original.pdf' else asset])
        if not stored: raise ApiError(404,'Document preview unavailable.')
        return HttpResponse(bytes(stored['data']),content_type='application/pdf' if asset=='original.pdf' else 'image/png')
    if row['status'] in ('queued','processing'):
        try:
            state=worker.call('/jobs/'+str(job_id))
            if state.get('active'): return JsonResponse(state['document'])
            # Processing may have completed between the database and worker reads.
            row=one('SELECT * FROM documents WHERE id=%s AND owner_id=%s',[job_id,actor['id']]) or row
        except ApiError: pass
    return JsonResponse(document(row))

def correct(request,actor,job_id):
    change=read_json(request,8192)
    with transaction.atomic():
        row=one('SELECT * FROM documents WHERE id=%s AND owner_id=%s AND expires_at>now() FOR UPDATE',[job_id,actor['id']])
        if not row: raise ApiError(404,'Document expired. Upload it again.')
        if row['status']!='complete': raise ApiError(409,'Wait for processing to finish.')
        if 'version' in change and change['version']!=row['version']:
            raise ApiError(409,'This document changed in another tab. Reload before editing.')
        doc=document(row); pi=change.get('page'); fi=change.get('field'); value=change.get('value')
        if type(pi) is not int or type(fi) is not int or pi<0 or fi<0 or not isinstance(value,str) or len(value)>4000:
            raise ApiError(400,'Invalid correction.')
        try: field=doc['pages'][pi]['fields'][fi]
        except (IndexError,KeyError): raise ApiError(400,'Invalid correction.')
        if field.get('kind')=='checkbox':
            if value!='None selected' and value not in [o['label'] for o in field['options']]:
                raise ApiError(400,'Choose one of the printed options, or None selected.')
            for option in field['options']: option['state']='selected' if option['label']==value else 'unselected'
        field.setdefault('originalValue',field.get('rawValue',field.get('value','')))
        field.update(userEdited=True,value=value,reviewed=True,status='reviewed')
        if re.fullmatch(r'Service \d+',field['group']):
            line=next((r for r in doc['pages'][pi].get('serviceLines',[]) if r['line']==int(field['group'].split()[1])),None)
            names=['Service date from','Service date to','Place of service','Emergency indicator','CPT / HCPCS','Modifiers','Diagnosis pointer','Charge','Days / units','EPSDT / family plan','ID qualifier','Rendering provider ID']
            if line and field['label'] in names: line['values'][names.index(field['label'])]=value
            extra={'Revenue code':'revenueCode','Service description':'description','Non-covered charges':'nonCovered'}
            if line and field['label'] in extra: line[extra[field['label']]]=value
        doc=worker.call('/verify','POST',doc)
        version=row['version']+1; doc['version']=version
        query('UPDATE documents SET result=%s,version=%s,updated_at=now() WHERE id=%s',[encoded(doc),version,job_id])
        audit(request,actor,'document_updated','documents',job_id,{'page':pi+1,'field':field['label']})
    return JsonResponse({'version':version,'field':doc['pages'][pi]['fields'][fi],'pages':doc['pages'],'verification':doc['verification'],'serviceLines':doc['pages'][pi].get('serviceLines',[])})
