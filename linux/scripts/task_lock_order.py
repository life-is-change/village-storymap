"""Exact parent-before-child lock transformations for the local GPU queue."""
from autonomous_bundle import load_script
browser=load_script('repair-autonomous-browser')
geo=load_script('repair-autonomous-geo-results')

REPLACEMENTS={'local_worker_call': [('  FOR r IN SELECT * FROM api_private.local_gpu_runs WHERE instance_id=instance AND '
                        'kind=w.kind AND lease_until<=now() AND status '
                        "IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating','cancel_requested') "
                        'ORDER BY lease_until LIMIT 20 FOR UPDATE SKIP LOCKED LOOP\n',
                        '  FOR r IN SELECT g.* FROM api_private.task_requests t JOIN '
                        'api_private.local_gpu_runs g ON g.id=t.id WHERE t.instance_id=instance AND '
                        'g.instance_id=instance AND g.kind=w.kind AND g.lease_until<=now() AND g.status '
                        "IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating','cancel_requested') "
                        'ORDER BY g.lease_until LIMIT 20 FOR UPDATE OF t SKIP LOCKED LOOP\n'
                        '   SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=r.id AND '
                        'instance_id=instance AND kind=w.kind AND lease_until<=now() AND status '
                        "IN('claimed','running','claimed_rectification','rectifying','claimed_generation','generating','cancel_requested') "
                        'FOR UPDATE;\n'
                        '   IF NOT FOUND THEN CONTINUE;END IF;\n'),
                       ('   SELECT * INTO r FROM api_private.local_gpu_runs WHERE instance_id=instance AND '
                        "kind=w.kind AND status IN('queued','queued_rectification','queued_generation') AND "
                        'next_at<=now() AND attempts<5 ORDER BY next_at,created_at,id LIMIT 1 FOR UPDATE '
                        'SKIP LOCKED;\n',
                        '   SELECT g.* INTO r FROM api_private.task_requests t JOIN '
                        'api_private.local_gpu_runs g ON g.id=t.id WHERE t.instance_id=instance AND '
                        'g.instance_id=instance AND g.kind=w.kind AND g.status '
                        "IN('queued','queued_rectification','queued_generation') AND g.next_at<=now() AND "
                        'g.attempts<5 ORDER BY g.next_at,g.created_at,g.id LIMIT 1 FOR UPDATE OF t SKIP '
                        'LOCKED;\n'),
                       ('   IF api_private.local_gpu_guard(r) THEN EXIT;END IF;\n',
                        '   SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=r.id AND '
                        'instance_id=instance AND kind=w.kind AND status '
                        "IN('queued','queued_rectification','queued_generation') AND next_at<=now() AND "
                        'attempts<5 FOR UPDATE;\n'
                        '   IF NOT FOUND THEN CONTINUE;END IF;\n'
                        '   IF api_private.local_gpu_guard(r) THEN EXIT;END IF;\n'),
                       (' SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid AND '
                        'instance_id=instance AND kind=w.kind FOR UPDATE;\n',
                        ' -- Match local_task_control: parent task before child run. Holding the run\n'
                        ' -- first while local_gpu_sync waits for the task can deadlock status polling.\n'
                        ' PERFORM 1 FROM api_private.task_requests WHERE id=rid AND instance_id=instance AND '
                        'kind=w.kind FOR UPDATE;\n'
                        " IF NOT FOUND THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;\n"
                        ' SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid AND '
                        'instance_id=instance AND kind=w.kind FOR UPDATE;\n')],
 'local_worker_file': [(' SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid AND '
                        'instance_id=instance FOR UPDATE;\n',
                        ' PERFORM 1 FROM api_private.task_requests WHERE id=rid AND instance_id=instance AND '
                        'kind=w.kind FOR UPDATE;\n'
                        " IF NOT FOUND THEN RETURN jsonb_build_object('error','LEASE_LOST');END IF;\n"
                        ' SELECT * INTO r FROM api_private.local_gpu_runs WHERE id=rid AND '
                        'instance_id=instance FOR UPDATE;\n')]}

SIGNATURES={'local_worker_call':'uuid,text,text,text,uuid,uuid,jsonb','local_worker_file':'uuid,text,text,text,uuid,uuid,jsonb'}


def body_pair(source,name):
    body=browser.function_body(source,name)
    if name=='local_worker_file':
        old,new=geo.REPLACEMENTS[1][2:]
        if body.count(old)+body.count(new)!=1:raise ValueError('KNOWN_GEO_MAPPING_REQUIRED')
        body=body.replace(old,new)
    before=body
    for old,new in reversed(REPLACEMENTS[name]):
        if before.count(new)==1:before=before.replace(new,old)
        elif before.count(old)!=1:raise ValueError('KNOWN_TASK_LOCK_BODY_REQUIRED')
    after=before
    for old,new in REPLACEMENTS[name]:
        if after.count(old)!=1:raise ValueError('KNOWN_TASK_LOCK_BODY_REQUIRED')
        after=after.replace(old,new)
    return before,after


def patch_sql(queue,files,*,apply=True):
    parts=['BEGIN;',"SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='15s';",
        "DO $guard$BEGIN IF current_database()<>'village_unified_candidate' OR api_private.installation_version()<>1 THEN RAISE EXCEPTION 'LOCAL_DATABASE_REQUIRED';END IF;END$guard$;"]
    quote=lambda value:"'"+value.replace("'","''")+"'"
    for name,source in [('local_worker_call',queue),('local_worker_file',files)]:
        before,after=body_pair(source,name)
        change="IF actual=original THEN EXECUTE replace(definition,original,patched);END IF;" if apply else ''
        parts.append("DO $repair$DECLARE original text:="+quote(before)+";patched text:="+quote(after)+";actual text;definition text;BEGIN\n"
            +"SELECT prosrc,pg_get_functiondef(oid) INTO actual,definition FROM pg_proc WHERE oid='api_private."+name+'('+SIGNATURES[name]+")'::regprocedure;\n"
            +"IF actual IS NULL OR actual NOT IN(original,patched) THEN RAISE EXCEPTION 'TASK_LOCK_FUNCTION_CHANGED';END IF;\n"+change+'\nEND$repair$;')
    return '\n'.join(parts)+'\nCOMMIT;\n'
