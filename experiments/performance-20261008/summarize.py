"""Summarize local RTX 4060 browser samples; phases overlap and include network waits."""
from pathlib import Path
import json, statistics, shutil
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'discussion-delivery-20261007/experiments/results'
out=Path(__file__).resolve().parent
samples=[]
for f in source.glob('sample-*.json'):
 d=json.loads(f.read_text(encoding='utf-8')); d['_file']=f.name; samples.append(d)
def rows(labels,phase,files=()):
 return sorted([{'file':s['_file'],'label':s['label'],'ms':[r['duration_ms'] for r in s['records'] if r['kind']=='phase' and r['name']==phase and not r.get('failed')][-1]}
 for s in samples if (s['label'] in labels or s['_file'] in files) and any(r['kind']=='phase' and r['name']==phase and not r.get('failed') for r in s['records'])],key=lambda s:s['file'])
def stats(r):
 v=[x['ms'] for x in r]
 return {'samples':r,'median_ms':statistics.median(v) if v else None,'min_ms':min(v) if v else None,'max_ms':max(v) if v else None}
groups={
'layer_restore':('refresh2DOverlay',['4060-before-layer-round2','4060-before-layer-round3'],['sample-1791445796635841600.json'],'layer'),
'warm_3d':('3d_enter',['4060-before-3d-round2','4060-before-3d-round3'],['sample-1791446290583250100.json'],'3d'),
'studio_open':('openSceneStudioWorkspace',['4060-before-studio','4060-before-studio-round2','4060-before-studio-round3'],[],'studio')}
result={'hardware':'RTX 4060 Laptop GPU','live_results':{},'limits':['Warm repeated operations; independent real network requests vary.','Different browser viewport sizes occurred; do not infer FPS improvements.','First cold 3D enter was not instrumented; module-load time is not full 3D readiness.','Invalid old-script-cache samples are excluded; after labels must start 4060-after-v3-.','No real 100-building texture upload or GPU frame-rate benchmark.']}
selected=set()
for name,(phase,labels,files,suffix) in groups.items():
 before=rows(labels,phase,files);after=rows([f'4060-after-v3-{suffix}-round{i}' for i in range(1,4)],phase)
 result['live_results'][name]={'before':stats(before),'after':stats(after)}
 selected.update(x['file'] for x in before+after)
result['village_switch']=[{'file':s['_file'],'label':s['label'],'phases':[r for r in s['records'] if r['kind']=='phase']} for s in samples if s['label'] in ['4060-before-switch-hongxing','4060-before-switch-mibu-warm','4060-after-v3-switch-hongxing','4060-after-v3-switch-mibu']]
selected.update(s['file'] for s in result['village_switch'])
for name in selected:
 dest=out/'browser-samples'/name; dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source/name,dest)
(out/'browser-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
