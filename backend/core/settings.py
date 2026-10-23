"""
Django settings for core project.
NexusAI Agent Systems - Agentic Tool Gateway & Tax Engine
"""

from pathlib import Path
import socket
from urllib.parse import urlparse, unquote
from decouple import config, Csv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Security and Debug
SECRET_KEY = config('SECRET_KEY', default='nexus-ai-super-secret-gateway-key-34b8aee8-2026-production')
DEBUG = config('DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='*,localhost,127.0.0.1', cast=Csv())

# Application definition - Daphne must be listed first before staticfiles
INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third-party apps
    'rest_framework',
    'channels',
    
    # Local apps
    'tools.apps.ToolsConfig',
    'tax_chat.apps.TaxChatConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'
ASGI_APPLICATION = 'core.asgi.application'

# Database Configuration with PostgreSQL and resilient local development fallback
DATABASE_URL = config('DATABASE_URL', default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}")

def _check_socket(host: str, port: int) -> bool:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2.5)
        res = sock.connect_ex((host, int(port)))
        sock.close()
        return res == 0
    except Exception:
        return False

if DATABASE_URL.startswith(('postgres://', 'postgresql://')):
    parsed_db = urlparse(DATABASE_URL)
    pg_host = parsed_db.hostname or 'localhost'
    pg_port = parsed_db.port or 5432
    pg_user = unquote(parsed_db.username or 'postgres')
    pg_password = unquote(parsed_db.password or '')
    pg_name = parsed_db.path.lstrip('/') or 'postgres'

    is_remote = pg_host not in ('localhost', '127.0.0.1')

    # If it is a remote database (e.g. Supabase, RDS) or local port is open, use PostgreSQL
    if is_remote or _check_socket(pg_host, pg_port):
        DATABASES = {
            'default': {
                'ENGINE': 'django.db.backends.postgresql',
                'NAME': pg_name,
                'USER': pg_user,
                'PASSWORD': pg_password,
                'HOST': pg_host,
                'PORT': str(pg_port),
            }
        }
    else:
        # Fallback to local SQLite when local Postgres port is offline to prevent crashes
        DATABASES = {
            'default': {
                'ENGINE': 'django.db.backends.sqlite3',
                'NAME': BASE_DIR / 'db.sqlite3',
            }
        }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

# Channels & Redis Layer Configuration
REDIS_URL = config('REDIS_URL', default='redis://127.0.0.1:6379/0')
parsed_redis = urlparse(REDIS_URL)
redis_host = parsed_redis.hostname or '127.0.0.1'
redis_port = parsed_redis.port or 6379

if _check_socket(redis_host, redis_port):
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [REDIS_URL],
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        },
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# REST Framework Configuration
REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.FormParser',
        'rest_framework.parsers.MultiPartParser',
    ],
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'core.authentication.ClerkJWTAuthentication',
    ],
}

CLERK_SECRET_KEY = config('CLERK_SECRET_KEY', default='')

# Google OAuth 2.0 Credentials (from Google Cloud Console -> APIs & Services -> Credentials)
GOOGLE_OAUTH_CLIENT_ID = config('GOOGLE_OAUTH_CLIENT_ID', default=config('GOOGLE_CLIENT_ID', default=''))
GOOGLE_OAUTH_CLIENT_SECRET = config('GOOGLE_OAUTH_CLIENT_SECRET', default=config('GOOGLE_CLIENT_SECRET', default=''))
GOOGLE_OAUTH_REDIRECT_URI = config(
    'GOOGLE_OAUTH_REDIRECT_URI',
    default='http://localhost:3000/api/proxy/oauth/google/callback/'
)


# Brand & Email Configuration
COMPANY_NAME = config('COMPANY_NAME', default="NexusAI Agent Systems")
COMPANY_SUPPORT_EMAIL = config('COMPANY_SUPPORT_EMAIL', default="support@nexusai.local")
EMAIL_BACKEND = config('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = config('EMAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_HOST_USER = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
DEFAULT_FROM_EMAIL = config('DEFAULT_FROM_EMAIL', default='NexusAI Systems <support@nexusai.local>')

# Default LLM Providers & Keys
GEMINI_API_KEY = config('GEMINI_API_KEY', default='')
GEMINI_MODELS_POOL = config(
    'GEMINI_MODELS_POOL',
    default='gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite',
    cast=Csv()
)
GROQ_API_KEY = config('GROQ_API_KEY', default='')
GROQ_MODELS_POOL = config(
    'GROQ_MODELS_POOL',
    default='openai/gpt-oss-20b,llama-3.1-8b-instant,qwen/qwen3.8-27b,openai/gpt-oss-120b',
    cast=Csv()
)
HF_GRAVITA_ENDPOINT = config('HF_GRAVITA_ENDPOINT', default='https://hf.space')
HF_TOKEN = config('HF_TOKEN', default='')

# Console Logging Configuration
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'console_format': {
            'format': '%(asctime)s [%(levelname)s] %(message)s',
            'datefmt': '%H:%M:%S',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'console_format',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'tools': {
            'handlers': ['console'],
            'level': 'DEBUG' if DEBUG else 'INFO',
            'propagate': False,
        },
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}

