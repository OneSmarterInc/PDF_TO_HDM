import os
os.environ.setdefault('DJANGO_SETTINGS_MODULE','backend.settings')
from django.core.wsgi import get_wsgi_application
from django.conf import settings
from whitenoise import WhiteNoise

application=WhiteNoise(get_wsgi_application(),root=str(settings.ROOT/'frontend'/'dist'),index_file=False)
# Serve only CSS and icons from the preserved design; legacy HTML/JS is not exposed.
application.add_files(str(settings.ROOT/'public'/'icons'),prefix='icons/')
for name in ('style.css','portal.css','favicon.svg'):
    application.add_file_to_dictionary('/'+name,str(settings.ROOT/'public'/name))
