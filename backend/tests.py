"""Contract tests for the Django boundary, without touching a live database."""
import json
import uuid
from unittest.mock import patch
from django.test import SimpleTestCase, RequestFactory
from . import security, documents, accounts

class AuthenticationContracts(SimpleTestCase):
    def setUp(self):
        self.factory=RequestFactory()
    def test_existing_node_argon2_hash_format_is_accepted(self):
        hashed=security.password_hash('Migration!Example42')
        self.assertTrue(hashed.startswith('$argon2id$v=19$m=65536,t=3,p=1$'))
        self.assertTrue(security.password_verify(hashed,'Migration!Example42'))
        node_format=hashed.replace('m=65536,t=3,p=1','m=65536,p=1,t=3')
        self.assertTrue(security.password_verify(node_format,'Migration!Example42'))
        self.assertFalse(security.password_verify(hashed,'incorrect'))
    def test_csrf_rejects_cross_origin_and_missing_token(self):
        actor={'csrf':'expected','must_change_password':False,'role':'user'}
        with patch.object(security,'identify',return_value=actor):
            for headers in ({},{'HTTP_ORIGIN':'https://evil.invalid','HTTP_X_CSRF_TOKEN':'expected'}):
                with self.assertRaises(security.ApiError) as error:
                    security.require_user(self.factory.post('/api/documents',**headers))
                self.assertEqual(error.exception.status,403)
    def test_forced_change_and_admin_role_are_enforced(self):
        with patch.object(security,'identify',return_value={'must_change_password':True,'role':'user'}):
            with self.assertRaises(security.ApiError) as error: security.require_user(self.factory.get('/api/documents'))
            self.assertEqual(error.exception.message,'PASSWORD_CHANGE_REQUIRED')
        with patch.object(security,'identify',return_value={'must_change_password':False,'role':'user'}):
            with self.assertRaises(security.ApiError): security.require_user(self.factory.get('/api/admin/users'),admin=True)
    def test_existing_session_cookie_and_csrf_digest_are_compatible(self):
        token='a'*64
        actor={'active':True}
        request=self.factory.get('/api/auth/me');request.COOKIES[security.cookie_name]=token
        with patch.object(security,'one',return_value=actor),patch.object(security,'query'):
            self.assertEqual(security.identify(request)['csrf'],security.digest('csrf:'+token))
    def test_invalid_account_and_pagination_input(self):
        with self.assertRaises(security.ApiError): accounts.account_input({'username':'bad','full_name':'Name','role':'user','active':'true'})
        for value in ('-1','1.5','100001','1;drop'):
            with self.assertRaises(security.ApiError): accounts.pagination(self.factory.get('/api/documents',{'page':value}))

class DocumentContracts(SimpleTestCase):
    def setUp(self): self.factory=RequestFactory()
    def test_other_owner_does_not_reach_worker(self):
        with patch.object(documents,'one',return_value=None),patch.object(documents.worker,'call') as call:
            with self.assertRaises(security.ApiError) as error:
                documents.documents(self.factory.get('/api/documents/x'),{'id':uuid.uuid4()},str(uuid.uuid4()))
            self.assertEqual(error.exception.status,404);call.assert_not_called()
    def test_database_result_overrides_stale_json_status_and_version(self):
        row={'id':uuid.uuid4(),'name':'claim.pdf','sha256':'a'*64,'status':'complete','version':4,'result':json.dumps({'status':'queued','version':0,'pages':[]})}
        result=documents.document(row)
        self.assertEqual(result['status'],'complete');self.assertEqual(result['version'],4)
    def test_invalid_upload_never_reaches_database(self):
        request=self.factory.post('/api/documents',b'not a pdf',content_type='application/pdf')
        with patch.object(documents,'query') as query:
            with self.assertRaises(security.ApiError) as error: documents.documents(request,{'id':uuid.uuid4()})
            self.assertEqual(error.exception.status,400);query.assert_not_called()
