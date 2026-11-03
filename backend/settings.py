import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit, unquote
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / '.env', override=False)
PRODUCTION = os.getenv('NODE_ENV') == 'production'
APP_ORIGIN = os.getenv('APP_ORIGIN', 'http://127.0.0.1:4317')
origin = urlsplit(APP_ORIGIN)
if origin.scheme not in ('http', 'https') or origin.path or origin.query or origin.fragment or origin.username:
    raise ValueError('APP_ORIGIN must be an exact HTTP(S) origin.')
if PRODUCTION and origin.scheme != 'https':
    raise ValueError('Production APP_ORIGIN must use HTTPS.')
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY') or secrets.token_hex(32)
DEBUG = False
ALLOWED_HOSTS = [origin.hostname, '127.0.0.1', 'localhost', '[::1]']
ROOT_URLCONF = 'backend.urls'
INSTALLED_APPS = []
MIDDLEWARE = ['backend.middleware.PortalMiddleware']
USE_TZ = True
TIME_ZONE = 'UTC'
DATA_UPLOAD_MAX_MEMORY_SIZE = 31 * 1024 * 1024
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
url = urlsplit(os.environ['DATABASE_URL'])
if url.scheme not in ('postgres', 'postgresql'):
    raise ValueError('DATABASE_URL must be PostgreSQL.')
ssl_mode = os.getenv('DATABASE_SSL_MODE', 'disable')
if ssl_mode not in ('disable', 'verify-full'):
    raise ValueError('Invalid DATABASE_SSL_MODE.')
if PRODUCTION and url.hostname not in ('localhost', '127.0.0.1', '::1') and ssl_mode != 'verify-full':
    raise ValueError('Remote production PostgreSQL requires verified TLS.')
if url.query:
    raise ValueError('Use DATABASE_SSL_MODE and DATABASE_SSL_CA_FILE, not URL query parameters.')
options = {'connect_timeout': 5, 'options': '-c statement_timeout=15000', 'sslmode': ssl_mode}
if ssl_mode == 'verify-full':
    options['sslrootcert'] = os.environ['DATABASE_SSL_CA_FILE']
DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': unquote(url.path[1:]),
    'USER': unquote(url.username or ''), 'PASSWORD': unquote(url.password or ''),
    'HOST': url.hostname, 'PORT': url.port or 5432, 'OPTIONS': options,
    'CONN_MAX_AGE': 60, 'CONN_HEALTH_CHECKS': True}}
