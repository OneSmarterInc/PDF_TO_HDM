import json
from django.db import connection
from django.core.serializers.json import DjangoJSONEncoder

def query(sql, params=()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        if cursor.description:
            names = [c[0] for c in cursor.description]
            return [dict(zip(names, row)) for row in cursor.fetchall()]
        return []

def one(sql, params=()):
    rows = query(sql, params)
    return rows[0] if rows else None

def encoded(value):
    return json.dumps(value, cls=DjangoJSONEncoder)

def decoded(value):
    return json.loads(value) if isinstance(value, str) else value
