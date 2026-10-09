#!/usr/bin/env python3
"""Jah Noah [Q008]: "let's explore this nebula. Let's coalesce it into something that I can deploy"
Engineering: a small terminal client for the actual pilot API; no browser login is assumed.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


def private_write(path, value):
    """Jah Noah [Q007]: "all my projects are sovereign"
    Engineering: local access files contain secrets; owner-only permissions and no token printing.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(value, out, indent=2)
    os.chmod(path, 0o600)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def call(access, path, payload=None, key=None):
    """Jah Noah [Q001]: "you define the rules and scope of the room, and then you create it."
    Engineering: authenticated operations use one exact origin and a retry identifier.
    """
    parsed = urllib.parse.urlsplit(access['public_url'])
    local = parsed.hostname in ('localhost', '127.0.0.1', '::1')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and local):
        raise ValueError('HTTPS required except localhost')
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('public_url must be an origin')
    if not path.startswith('/v1/') or path.startswith('//') or '\\' in path:
        raise ValueError('path must start /v1/')
    headers = {'Authorization': 'Bearer ' + access['token'], 'Content-Type': 'application/json'}
    body = None
    if payload is not None:
        headers['Idempotency-Key'] = key or str(uuid.uuid4())
        body = json.dumps(payload).encode()
    request = urllib.request.Request(access['public_url'].rstrip('/') + path, headers=headers, data=body)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as result:
        return json.load(result)


parser = argparse.ArgumentParser(description='Ark Core pilot terminal examples; Python 3 standard library only.')
parser.add_argument('command', choices=['get', 'post', 'enroll', 'upload', 'revise', 'download', 'peer-config'])
parser.add_argument('access_file')
parser.add_argument('args', nargs='*')
parser.add_argument('--kind', choices=['human', 'service'], default='human')
parser.add_argument('--ttl', type=int, default=86400)
parser.add_argument('--operation-id')
parser.add_argument('--peer-name', default='source')
opts = parser.parse_args()
try:
    access = json.loads(Path(opts.access_file).read_text())
    args = opts.args
    if opts.command == 'get':
        result = call(access, args[0] if args else '/v1/node')
    elif opts.command == 'post':
        result = call(access, args[0], json.loads(args[1]), opts.operation_id)
    elif opts.command == 'enroll':
        name, output = args
        path = Path(output)
        if path.exists():
            pending = json.loads(path.read_text())
            if pending.get('state') != 'pending' or pending.get('name') != name or pending.get('public_url') != access['public_url']:
                raise ValueError('output already exists; use another file or resume its exact pending enrollment')
        else:
            token = secrets.token_hex(32)
            pending = {'state': 'pending', 'name': name, 'public_url': access['public_url'], 'token': token,
                       'operation_id': str(uuid.uuid4()),
                       'payload': {'name': name, 'human': opts.kind == 'human', 'ttl_seconds': opts.ttl,
                                   'token_hash': hashlib.sha256(token.encode()).hexdigest()}}
            private_write(path, pending)
        receipt = call(access, '/v1/admin/identities', pending['payload'], pending['operation_id'])
        private_write(path, {'state': 'enrolled', 'name': name, 'identity_id': receipt['id'],
                             'token': pending['token'], 'public_url': access['public_url'],
                             'expires_at': receipt['expires_at']})
        result = {'identity_id': receipt['id'], 'access_file': str(path), 'expires_at': receipt['expires_at']}
    elif opts.command in ('upload', 'revise'):
        target, title_or_base, filename = args
        raw = Path(filename).read_bytes()
        if len(raw) > 1048576:
            raise ValueError('pilot file limit is 1 MiB')
        payload = {'content_base64': base64.b64encode(raw).decode()}
        if opts.command == 'upload':
            payload.update({'title': title_or_base, 'kind': 'document'})
            route = '/v1/rooms/' + target + '/resources'
        else:
            payload['base_revision_id'] = title_or_base
            route = '/v1/resources/' + target + '/revisions'
        result = call(access, route, payload, opts.operation_id)
    elif opts.command == 'download':
        resource, revision, filename = args
        response = call(access, '/v1/resources/' + resource + '/content?revision=' + urllib.parse.quote(revision, safe=''))
        destination = Path(filename)
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as out:
            out.write(base64.b64decode(response['content_base64'], validate=True))
        result = {'file': str(destination), 'revision_id': response['revision']['id']}
    else:
        node_id, filename = args
        if Path(filename).exists():
            raise ValueError('peer config already exists; choose a new path')
        private_write(filename, {opts.peer_name: {'url': access['public_url'], 'node_id': node_id, 'token': access['token']}})
        result = {'peer_config': filename, 'peer_name': opts.peer_name}
    print(json.dumps(result, indent=2))
except urllib.error.HTTPError as error:
    print(f'HTTP {error.code}: {error.read().decode()}', file=sys.stderr)
    sys.exit(1)
except (ValueError, KeyError, IndexError, OSError, urllib.error.URLError) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
