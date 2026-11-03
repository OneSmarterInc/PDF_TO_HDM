import uuid
from django.conf import settings

class PortalMiddleware:
    def __init__(self,get_response):
        self.get_response=get_response
    def __call__(self,request):
        request.request_id=str(uuid.uuid4())
        request.get_host()  # Enforce ALLOWED_HOSTS even with the compatible custom session API.
        response=self.get_response(request)
        response['X-Request-ID']=request.request_id
        response['X-Content-Type-Options']='nosniff'
        response['X-Frame-Options']='SAMEORIGIN'
        response['Referrer-Policy']='no-referrer'
        response['Permissions-Policy']='camera=(), microphone=(), geolocation=()'
        response['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
        response.setdefault('Cache-Control','no-store')
        if settings.PRODUCTION:
            response['Strict-Transport-Security']='max-age=31536000'
        return response
