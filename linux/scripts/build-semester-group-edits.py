"""Build exact contextual edits against an explicit reviewed base commit."""
import argparse
import difflib
import json
from pathlib import Path
import re
import subprocess

ROOT=Path(__file__).resolve().parents[2]
WEB=('admin.html','admin.js','app.js','features/admin/group-plan-admin.js',
     'features/course/course-service.js','features/villages/village-client.js','features/data/unified-operation-routes.js')


def changes(before,after):
    old=before.replace('\r\n','\n').splitlines(keepends=True)
    new=after.replace('\r\n','\n').splitlines(keepends=True)
    result=[]
    for group in difflib.SequenceMatcher(None,old,new,autojunk=False).get_grouped_opcodes(4):
        a,b=group[0],group[-1]
        result.append({'before':''.join(old[a[1]:b[2]]),'after':''.join(new[a[3]:b[4]])})
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--base',required=True);args=parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}',args.base):raise ValueError('EXPLICIT_BASE_COMMIT_REQUIRED')
    def edits(name):
        old=subprocess.check_output(['git','show',args.base+':'+name],cwd=ROOT).decode('utf8')
        return changes(old,(ROOT/name).read_text(encoding='utf8'))
    data={'base_commit':args.base,'web':{name:edits(name) for name in WEB},'contracts':edits('business-api/unified/contracts.mjs')}
    if any(not v for v in data['web'].values()) or not data['contracts']:raise ValueError('SEMESTER_PATCH_EMPTY')
    (ROOT/'linux/semester-group-web-edits.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('SEMESTER_CONTEXTUAL_EDITS_BUILT')


if __name__=='__main__':main()
