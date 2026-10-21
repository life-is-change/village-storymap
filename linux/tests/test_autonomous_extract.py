import sys
import io
import tarfile
import gzip
import json
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))


def module():
    import autonomous_extract
    return autonomous_extract


def archive(path,entries):
    layer=io.BytesIO()
    with tarfile.open(fileobj=layer,mode='w') as stream:
        for name,body,kind in entries:
            info=tarfile.TarInfo(name);info.type=kind;info.size=len(body) if kind==tarfile.REGTYPE else 0
            stream.addfile(info,io.BytesIO(body) if kind==tarfile.REGTYPE else None)
    raw=gzip.compress(layer.getvalue())
    with tarfile.open(path,'w:gz') as stream:
        for name,body in [('manifest.json',json.dumps([{'Layers':['layer.tar.gz']}]).encode()),('layer.tar.gz',raw)]:
            info=tarfile.TarInfo(name);info.size=len(body);stream.addfile(info,io.BytesIO(body))


def test_release_extraction_streams_only_audited_prefixes_as_operator_owned_files(tmp_path):
    m=module();source=tmp_path/'image.tar.gz';target=tmp_path/'release'
    archive(source,[('opt/village-web/index.html',b'web',tarfile.REGTYPE),('opt/village-schema/identity.sql',b'sql',tarfile.REGTYPE),
                    ('opt/village-control/deploy-autonomous.py',b'control',tarfile.REGTYPE),('opt/village/business-api/main.mjs',b'not exported',tarfile.REGTYPE)])
    result=m.extract_release(source,target,reserve=0)
    assert result=={name:m.tree_digest(target/name) for name in ('web','schema','control')}
    assert (target/'web/index.html').read_bytes()==b'web'
    assert not (target/'business-api').exists()
    with pytest.raises(ValueError):m.extract_release(source,target,reserve=0)


@pytest.mark.parametrize('name,kind',[('opt/village-web/../../outside',tarfile.REGTYPE),('/opt/village-web/index',tarfile.REGTYPE),
                                    ('opt/village-web/link',tarfile.SYMTYPE),('opt/village-control/a\\b',tarfile.REGTYPE)])
def test_untrusted_archive_paths_or_links_never_escape_new_release_directory(tmp_path,name,kind):
    m=module();source=tmp_path/'image.tar.gz';target=tmp_path/'release';archive(source,[(name,b'bad',kind)])
    with pytest.raises(ValueError):m.extract_release(source,target,reserve=0)
    assert not (tmp_path/'outside').exists()
