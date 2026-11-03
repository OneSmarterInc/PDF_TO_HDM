import os
import requests
from .security import ApiError

def call(path, method='GET', data=None, binary=False, timeout=10):
    token=os.environ.get('OCR_WORKER_TOKEN','')
    if len(token)<32: raise ApiError(503,'Document worker is not configured.')
    try:
        with requests.Session() as session:
            session.trust_env=False
            response=session.request(method,'http://127.0.0.1:'+os.getenv('OCR_WORKER_PORT','4319')+path,
                headers={'X-Worker-Token':token},json=data,timeout=timeout)
        if not response.ok:
            raise ApiError(response.status_code if response.status_code in (429,503) else 503,response.json().get('error','Document worker unavailable.'))
        return response.content if binary else response.json()
    except requests.RequestException:
        raise ApiError(503,'Document worker is restarting or unavailable. Please retry shortly.')
