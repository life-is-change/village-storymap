import importlib.util
import json
import io
from pathlib import Path
import pytest
P=Path(__file__).resolve().parents[1]/'scripts/probe-scene-write.py'
def module():
    spec=importlib.util.spec_from_file_location('scene_probe_test',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def test_probe_requires_save_conflict_versions_and_persistence():
    m=module();calls=[];checkpoints=[]
    doc={'projectId':'project','revision':0,'baselineRef':{'revision':0},'objects':[]}
    def call(op,input,expected=200,anonymous=False):
        calls.append((op,expected,anonymous))
        if anonymous:return {'error':{'code':'UNAUTHORIZED'}}
        if op=='create':return {'id':'project','revision':0}
        if op=='load':return dict(doc,projectId=input['projectId'],revision=0 if input['projectId']=='branch' else doc['revision'])
        if op=='save':
            if expected==409:return {'error':{'code':'REVISION_CONFLICT','remoteRevision':1}}
            doc.update(input['document']);doc['revision']=1;return {'revision':1}
        if op=='version':return {'id':'version','revision':1}
        if op=='versions':return [{'id':'version','revision':1,'submission_status':'submitted'}]
        if op=='restore':return {'id':'restored','revision':1}
        if op=='branch':return {'id':'branch','revision':0}
        if op=='submit':return {'submissionStatus':'submitted'}
    result=m.perform_write_probe(call,{},lambda:calls.append(('restart',200,False)),checkpoints.append)
    assert result['status']=='authenticated_scene_write_probe_passed'
    assert result['restart_persistence'] is True and result['created_drafts']==3
    assert calls.count(('restart',200,False))==1
    assert ('save',409,False) in calls and ('load',401,True) in calls
    assert checkpoints and checkpoints[0]['phase']=='created'

def test_probe_accepts_exact_bigint_revision_strings_from_pg_query_rows():
    m=module();doc={'projectId':'p','revision':0,'baselineRef':{'revision':0},'objects':[]}
    def call(op,input,expected=200,anonymous=False):
        if anonymous:return {'error':{'code':'UNAUTHORIZED'}}
        if op=='create':return {'id':'p','revision':0}
        if op=='load':return dict(doc,projectId=input['projectId'],revision=0 if input['projectId']=='branch' else doc['revision'])
        if op=='save':
            if expected==409:return {'error':{'code':'REVISION_CONFLICT','remoteRevision':1}}
            doc.update(input['document']);doc['revision']=1;return {'revision':1}
        if op=='version':return {'id':'v','revision':1}
        if op=='versions':return [{'id':'v','revision':'1','submission_status':'submitted'}]
        if op=='restore':return {'id':'restored','revision':1}
        if op=='branch':return {'id':'branch','revision':0}
        if op=='submit':return {'submissionStatus':'submitted'}
    assert m.perform_write_probe(call,{},lambda:None,lambda v:None)['status']=='authenticated_scene_write_probe_passed'

def test_revision_comparison_never_accepts_bool_float_or_noncanonical_numbers():
    m=module()
    for value in (1,'1'):assert m.revision_matches(value,1)
    for value in (True,1.0,'01','+1','1.0','1private',None):assert not m.revision_matches(value,1)

def test_failed_http_probe_exposes_only_step_status_and_allowlisted_api_code():
    m=module()
    class Response(io.BytesIO):status=503
    class Client:
        def open(self,*args,**kwargs):return Response(b'{"error":{"code":"DB_UNAVAILABLE","message":"private SQL credential","token":"secret"}}')
    with pytest.raises(ValueError) as caught:m.json_response(Client(),object())
    assert caught.value.http_status==503 and caught.value.api_code=='DB_UNAVAILABLE'
    assert 'private' not in str(caught.value) and 'secret' not in str(caught.value)
    with pytest.raises(ValueError) as diagnostic:
        def call(*args,**kwargs):raise caught.value
        m.perform_write_probe(call,{},lambda:None,lambda v:None)
    assert 'phase=anonymous' in str(diagnostic.value) and 'http_status=503' in str(diagnostic.value)

def test_probe_rejects_lost_persistence_after_restart():
    m=module();doc={'projectId':'p','revision':0,'baselineRef':{'revision':0},'objects':[]};restarted=False
    def restart():
        nonlocal restarted;restarted=True
    def call(op,input,expected=200,anonymous=False):
        if anonymous:return {'error':{'code':'UNAUTHORIZED'}}
        if op=='create':return {'id':'p','revision':0}
        if op=='load':return doc|({'revision':0} if restarted else {})
        if op=='save':
            if expected==409:return {'error':{'code':'REVISION_CONFLICT','remoteRevision':1}}
            doc.update(input['document']);doc['revision']=1;return {'revision':1}
        if op=='version':return {'id':'v','revision':1}
        if op=='versions':return [{'id':'v','revision':1}]
        if op in ('restore','branch'):return {'id':'new','revision':1 if op=='restore' else 0}
        if op=='submit':return {'submissionStatus':'submitted'}
    with pytest.raises(ValueError):m.perform_write_probe(call,{},restart,lambda v:None)

def test_acceptance_requires_current_recent_proof():
    m=module();p={'status':'restart_verified','attempt_id':'id','verified_at':10,'runtime_fingerprint':'same'}
    m.acceptance_ready(p,'same',now=20)
    for f,n in [('wrong',20),('same',4000),('same',5)]:
        with pytest.raises(ValueError):m.acceptance_ready(p,f,now=n)

def test_admin_probe_uses_private_sandbox_when_formal_group_plans_do_not_exist():
    m=module();uid='40000000-0000-4000-8000-000000000004'
    context={'teachingProjectId':'project','villageId':'village','spaceId':'practice','groupId':None,'scopeKind':'admin_sandbox','baselineRevision':0}
    class Docker:
        def sql(self,query,database):
            assert database=='village_scene_validation'
            # The copied dataset has practice spaces, but zero group_plan rows.
            if "s.space_type='group_plan'" in query:return ''
            return json.dumps({'is_admin':True,'context':context})
    assert m.admin_context(Docker(),uid)==context

@pytest.mark.parametrize('result,code',[
    ({'is_admin':False,'context':None},'ADMIN_PROFILE_REQUIRED'),
    ({'is_admin':True,'context':None},'NO_VALID_SCENE_CONTEXT'),
])
def test_context_failure_reports_fixed_reason_without_private_rows(result,code):
    m=module()
    class Docker:
        def sql(self,*args):return json.dumps(result)
    with pytest.raises(ValueError,match=code):m.admin_context(Docker(),'40000000-0000-4000-8000-000000000004')
