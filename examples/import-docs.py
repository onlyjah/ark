#!/usr/bin/env python3
"""Jah Noah [Q009]: "this file may be out of date, but we can always, you know, synchronize it"
Engineering: add Markdown directly to a private Ark library; stable IDs avoid duplicates and updates require an explicit flag.
"""
import argparse
import http.cookiejar
import json
from pathlib import Path
import re
import urllib.request
import urllib.error
import urllib.parse
import uuid

parser=argparse.ArgumentParser(description='Import local Markdown into your private Ark document list.')
parser.add_argument('access_file')
parser.add_argument('files',nargs='+')
parser.add_argument('--update',action='store_true',help='Create a new server revision for an already imported document.')
args=parser.parse_args()
access=json.loads(Path(args.access_file).read_text())
origin=access['public_url'].rstrip('/')
u=urllib.parse.urlsplit(origin)
if u.scheme!='https' or u.path or u.query or u.fragment or u.username:
    raise SystemExit('Access file must specify an exact HTTPS origin.')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
jar=http.cookiejar.CookieJar()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),NoRedirect())
def call(path,body=None,csrf=None):
    headers={'Origin':origin,'Content-Type':'application/json'}
    if csrf:headers['X-Ark-Csrf']=csrf
    with opener.open(urllib.request.Request(origin+'/app/api/'+path,headers=headers,data=None if body is None else json.dumps(body).encode()),timeout=30) as response:
        return json.load(response)
profile=call('login',{'token':access['token']})
try:
    for filename in args.files:
        path=Path(filename)
        text=path.read_text()
        if len(text.encode())>1_000_000:raise ValueError('Document exceeds 1 MB: '+filename)
        source=path.name
        identity=str(uuid.uuid5(uuid.NAMESPACE_URL,origin+'/'+profile['id']+'/imports/'+source))
        title=re.search(r'^#\s+(.+)$',text,re.MULTILINE)
        title=title.group(1) if title else source
        current=None
        try:current=call('documents/'+identity)
        except urllib.error.HTTPError as e:
            if e.code!=404:raise
        if current and (current['body']==text or not args.update):
            print(json.dumps({'file':filename,'id':identity,'status':'already present; unchanged'}));continue
        receipt=call('documents',{'id':identity,'title':title[:256],'kind':'document','body':text,'source_path':source,'base_revision':current['head'] if current else None},profile['csrf'])
        print(json.dumps({'file':filename,'id':receipt['id'],'revision':receipt['head'],'status':'added' if not current else 'updated'}))
finally:call('logout',{},profile['csrf'])
