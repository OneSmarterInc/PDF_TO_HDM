"""Supervise Django/Waitress and the private OCR child in one deployment unit."""
import os
import secrets
import signal
import subprocess
import sys
import threading
from pathlib import Path
from dotenv import load_dotenv

ROOT=Path(__file__).resolve().parent
load_dotenv(ROOT/'.env',override=False)
os.environ.setdefault('OCR_WORKER_TOKEN',secrets.token_hex(32))
os.environ.setdefault('OCR_WORKER_PORT',str(int(os.getenv('PORT','4317'))+2))
os.environ.setdefault('PYTHON_PATH',sys.executable)
os.environ.setdefault('DJANGO_SETTINGS_MODULE','backend.settings')

def main():
    from backend.wsgi import application
    from waitress import create_server
    from django.conf import settings
    from backend.security import password_policy
    if settings.PRODUCTION: password_policy(os.getenv('TEMPORARY_PASSWORD'))
    worker=subprocess.Popen([os.getenv('NODE_BINARY','node'),'ocr-worker.mjs'],cwd=ROOT,env=os.environ.copy(),creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    server=create_server(application,host=os.getenv('HOST','127.0.0.1'),port=int(os.getenv('PORT','4317')),threads=12,max_request_body_size=31*1024*1024,clear_untrusted_proxy_headers=False)
    stopping=threading.Event()
    def stop(*_):
        stopping.set(); server.close()
        if worker.poll() is None:
            worker.terminate()
            try: worker.wait(timeout=95)
            except subprocess.TimeoutExpired: worker.kill(); worker.wait()
    def monitor():
        worker.wait()
        if not stopping.is_set():
            print('OCR worker exited; stopping portal for safe restart.',file=sys.stderr)
            server.close()
    threading.Thread(target=monitor,daemon=True).start()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    print('PDF Extractor HDM (React + Django) ready on '+os.getenv('HOST','127.0.0.1')+':'+os.getenv('PORT','4317'),flush=True)
    try: server.run()
    finally: stop()

if __name__=='__main__': main()
