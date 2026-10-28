"""Reconstruct the fixed pre-change browser bytes for disposable historical tests."""
import hashlib
import json
from pathlib import Path


def previous_component_sql(root,value):
    """Freeze a disposable historical release before the component migration."""
    baseline=json.loads((Path(root)/'linux/component-baseline.json').read_text(encoding='utf8'))
    for name,after in baseline['changes'].items():
        if after in value:value=value.replace(after,baseline['functions'][name],1)
    return value


def previous_source_bytes(root,name):
    value=(root/name).read_bytes()
    if name.endswith('.pdf'):return value
    value=value.replace(b'\r\n',b'\n')
    # Historical acceptance must reconstruct deployed bytes before semester edits,
    # rather than silently changing the checksums of earlier release fixtures.
    semester_path=root/'linux/semester-group-web-edits.json'
    if semester_path.is_file():
        semester=json.loads(semester_path.read_text(encoding='utf8'))
        changes=semester['web'].get(name,[]) if name!='business-api/unified/contracts.mjs' else semester['contracts']
        text=value.decode('utf8')
        for change in reversed(changes):
            if text.count(change['after'])!=1:raise ValueError('PREVIOUS_SEMESTER_SOURCE_FIXTURE_CHANGED')
            text=text.replace(change['after'],change['before'],1)
        value=text.encode('utf8')
    component=json.loads((root/'linux/tests/component-legacy-web.json').read_text(encoding='utf8'))
    text=value.decode('utf8')
    for change in reversed(component['files'].get(name,[])):
        if text.count(change['new'])!=1:raise ValueError('PREVIOUS_COMPONENT_WEB_CHANGED')
        text=text.replace(change['new'],change['old'],1)
    value=text.encode('utf8')
    fixture=json.loads((root/'linux/tests/single-personal-legacy-web.json').read_text(encoding='utf8'))
    if name not in fixture['files']:return value
    text=value.decode('utf8')
    for change in reversed(fixture['files'][name]):
        if text.count(change['new'])!=1:raise ValueError('PREVIOUS_PERSONAL_SOURCE_FIXTURE_CHANGED')
        text=text.replace(change['new'],change['old'],1)
    value=text.encode('utf8')
    expected=json.loads((root/'linux/single-personal-baseline.json').read_text())['files'][name]
    if hashlib.sha256(value).hexdigest()!=expected:raise ValueError('PREVIOUS_PERSONAL_SOURCE_DIGEST_DIFFERS')
    return value
