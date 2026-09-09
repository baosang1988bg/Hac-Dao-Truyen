"""Gửi chunk với retry hữu hạn; mỗi lần gửi đều reserve ngân sách trước."""
import http.client
import json
import ssl
import time


def send_chunk(conn,payload,*,host,sync_key,budget,max_retries=5,sleep=time.sleep):
    if not sync_key:return {'success':False,'error':'Thiếu sync key'},conn
    if budget is None:return {'success':False,'budget_exceeded':True,'error':'Chưa cấu hình ngân sách'},conn
    body=json.dumps(payload,ensure_ascii=False).encode('utf-8')
    if len(body)>2*1024*1024 or not 1<=len(payload.get('chapters',[]))<=25:
        return {'success':False,'error':'Chunk vượt giới hạn 25 chương/2 MiB'},conn
    last_error='Không gửi được chunk'
    for attempt in range(max_retries):
        # D1 gồm row/index writes: đây là dự phòng ước tính, không đảm bảo quota
        # billing toàn account. Retry cũng phải reserve kể cả timeout trước đó.
        r2=len(payload['chapters'])+bool(payload.get('synopsis'))
        d1=4*len(payload['chapters'])+5
        if not budget.try_reserve(r2,d1):
            return {'success':False,'budget_exceeded':True,'error':budget.stopped_reason},conn
        delay=min(60,2**attempt)
        try:
            if conn is None:conn=http.client.HTTPSConnection(host,context=ssl.create_default_context(),timeout=60)
            conn.request('POST','/api/admin/sync-novel',body=body,headers={'Content-Type':'application/json','x-sync-key':sync_key})
            res=conn.getresponse();text=res.read().decode('utf-8',errors='replace')
            if res.status==200:
                data=json.loads(text)
                return {'success':bool(data.get('success')),'error':data.get('error','')},conn
            last_error=f'HTTP {res.status}: {text[:120]}'
            if res.status not in (429,500,502,503,504):return {'success':False,'error':last_error},conn
            retry=res.getheader('Retry-After')
            if retry and retry.isdigit():delay=min(120,max(delay,int(retry)))
        except (OSError,http.client.HTTPException,ValueError) as exc:
            last_error=str(exc)
        if conn:
            conn.close();conn=None
        if attempt+1<max_retries:sleep(delay)
    return {'success':False,'error':last_error},conn
