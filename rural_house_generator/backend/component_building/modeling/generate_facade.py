"""Compile a validated facade-v2 scene using unchanged V3 geometry functions."""
import ast
import hashlib
import json
import math
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import v3_parts as v
import component_geometry as components

# Blender 3.6 requires Auto Smooth for the V3 weighted-normal modifiers.
original_box=v.box
def smooth_box(*args,**kwargs):
    ob=original_box(*args,**kwargs)
    ob.data.use_auto_smooth=True
    return ob
v.box=smooth_box

cfg=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text('utf8'))
s=cfg['spec'];f=s['facade'];out=Path(cfg['output']);out.parent.mkdir(parents=True,exist_ok=True)
v.H=s['floors']*s['floor_height'];v.FLOOR_HEIGHT=s['floor_height']
W,D,H=f['width'],f['depth'],v.H
if f['roof'].get('palette')=='gray':
    for mat,col in zip(v.M_ROOF,[(.13,.17,.21),(.17,.21,.25),(.10,.13,.17)]):
        mat.diffuse_color=(*col,1)
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*col,1)
    v.M_ROOF_SIDE.diffuse_color=(.10,.12,.14,1)
    v.M_ROOF_SIDE.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.10,.12,.14,1)

profile=f.get('render_profile','v3-original')
if profile=='v3-natural':
    from natural_materials import apply_natural
    apply_natural(v,HERE.parent/'.cache/materials/v3-natural',f['roof'].get('palette')=='gray')
if profile=='rural-realistic':
    import realistic_materials as realistic
    rail_material=realistic.apply_materials(v,f['roof'].get('palette')=='gray',f.get('appearance'),f.get('wall_joints',True),f['roof'].get('texture'))
hidden=f.get('completion',{}).get('openings',[])
structure=f.get('structure',{})


def opening(o):
    return dict(v.op(o['x'],o['width'],o['bottom'],o['bottom']+o['height'],
                o['kind'],o['arch_rise'] if o['shape']=='arched' else 0),subtype=o.get('subtype'))


def blocked(x,z,ops,margin=.10):
    return any(o['x']-o['w']/2-margin<x<o['x']+o['w']/2+margin
               and o['b']-margin<z<v.arch_top(o,max(o['x']-o['w']/2,min(o['x']+o['w']/2,x)))+margin
               for o in ops)


def stone_details(m,ops):
    x0,x1,y=m['x0'],m['x1'],m['front']
    # Bands are split around openings, including tall arches.
    for z in [.35]+[s['floor_height']*i for i in range(1,s['floors'])]+[H-.13]:
        segments=[];start=None;step=.06;n=math.ceil((x1-x0)/step)
        for i in range(n+1):
            x=x0+(x1-x0)*i/n;free=not blocked(x,z,ops,.12)
            if free and start is None:start=x
            if start is not None and (not free or i==n):
                if x-start>.06:segments.append((start,x))
                start=None
        for a,b in segments:
            v.box('Facade_Cornice',((a+b)/2,y-.16,z),(b-a,.16,.13),v.M_WHITE,'Stone_Details',.012)
    if profile=='rural-realistic' or not f.get('wall_joints',True):return
    verts=[];faces=[]
    def quad(xa,xb,za,zb):
        i=len(verts);fy=y-v.T/2-.009
        verts.extend([(xa,fy,za),(xb,fy,za),(xb,fy,zb),(xa,fy,zb)]);faces.append((i,i+1,i+2,i+3))
    z=.70
    while z<H-.25:
        x=x0
        while x<x1-.01:
            b=min(x+.08,x1)
            if not blocked((x+b)/2,z,ops,.12):quad(x,b,z-.005,z+.005)
            x=b
        z+=.68
    x=x0+.55
    while x<x1-.10:
        z=.35
        while z<H-.25:
            hi=min(z+.08,H-.25)
            if not blocked(x,(z+hi)/2,ops,.12):quad(x-.004,x+.004,z,hi)
            z=hi
        x+=1.1
    if faces:v.mesh('V3_Stone_Joints',verts,faces,v.M_JOINT,'Stone_Details')


def gable_roof(m):
    x0,x1=m['x0']-.38,m['x1']+.38;y0,y1=m['front']-.38,D+.38
    z=H+.20;r=f['roof']['rise'];mid=(y0+y1)/2
    vs=[(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z),(x0,mid,z+r),(x1,mid,z+r)]
    v.mesh('Gable_Roof',vs,[(0,1,5,4),(3,4,5,2)],v.M_ROOF[0],'Roofs')
    v.mesh('Closed_Gable_Ends',vs,[(0,4,3),(1,2,5),(0,3,2,1)],v.M_ROOF_SIDE,'Roofs')
    vertices=[];faces=[];shades=[]
    for aa,bb,cc,dd in [(0,1,4,5),(3,2,4,5)]:
        A,B,C,E=[Vector(vs[i]) for i in (aa,bb,cc,dd)]
        for row in range(16):
            for col in range(36):
                q=[]
                for u,t in [(col/36,row/16),((col+1)/36,row/16),((col+1)/36,(row+1)/16),(col/36,(row+1)/16)]:
                    p=A.lerp(B,u).lerp(C.lerp(E,u),t);q.append((p.x,p.y,p.z+.03+.01*(row%2)))
                i=len(vertices);vertices+=q;faces.append((i,i+1,i+2,i+3));shades.append(v.RNG.randrange(3))
    ob=v.mesh('Gable_V3_Style_Tiles',vertices,faces,v.M_ROOF[0],'Roof_Tiles')
    for mat in v.M_ROOF[1:]:ob.data.materials.append(mat)
    for poly,k in zip(ob.data.polygons,shades):poly.material_index=k
    v.stroke('Gable_Ridge',[vs[4],vs[5]],.08,v.M_ROOF[1],'Roofs')
    for a,b in ((0,1),(3,2)):
        A,B=Vector(vs[a]),Vector(vs[b]);p=(A+B)/2
        v.box('Gable_Eave',tuple(p-Vector((0,0,.1))),(x1-x0,.27,.20),v.M_WHITE,'Roofs',.01)


roof_core_objects=[]
for i,m in enumerate(f['masses']):
    x0,x1,y=m['x0'],m['x1'],m['front']
    ops=[opening(o) for o in f['openings'] if o['mass']==m['id']]
    components.front_facade(v,f'Front_{i}',m,ops,structure)
    v.facade(f'Rear_{i}','X',D,x0,x1,[opening(o) for o in hidden if o['face']=='rear' and o['mass']==m['id']],1)
    if i==0:v.facade('Left_Exterior','Y',x0,y,D,[opening(o) for o in hidden if o['face']=='left'],-1)
    else:
        other=f['masses'][i-1]
        if abs(other['front']-y)>.01:
            v.facade('Stepped_Return','Y',x0,min(y,other['front']),max(y,other['front']),[], -1 if y<other['front'] else 1)
    if i==len(f['masses'])-1:v.facade('Right_Exterior','Y',x1,y,D,[opening(o) for o in hidden if o['face']=='right'],1)
    v.box('Stone_Socle',((x0+x1)/2,(y+D)/2,.08),(x1-x0+.12,D-y+.12,.16),v.M_STEPS,'Stone_Details',.015)
    stone_details(m,ops)
    roof=f['roof']
    if roof['type']=='hip':roof_core_objects.append(components.hip(v,f'Roof_{i}',m,H,roof,D))
    elif roof['type']=='gable':roof_core_objects.append(components.gable(v,m,H,roof,D))
    else:
        roof_core_objects.append(v.box('Flat_Roof_Slab',((x0+x1)/2,(y+D)/2,H+.10),(x1-x0+.3,D-y+.3,.24),v.M_CONCRETE,'Roofs',.02))
        for yy in (y,D):v.box('Flat_Parapet',((x0+x1)/2,yy,H+.42),(x1-x0+.16,.18,.6),v.M_WHITE,'Roofs',.01)

components.porch_frames(v,structure,f['masses'],{m['id']:[opening(o) for o in f['openings'] if o['mass']==m['id']] for m in f['masses']},s['floor_height'])
components.roof_details(v,f['roof'],H,D)
railing_styles=[]
metal_railing_segments=0
for i,b in enumerate(f['balconies']):
    m=min(f['masses'],key=lambda m:abs((m['x0']+m['x1'])/2-b['x']))
    y=components.wall_front(m,structure,b['x'],min(H-.01,b['base']+.15))-.15
    front=m['front']-.08 if y>m['front']+.1 else y-b['depth'];lo=b['x']-b['width']/2;hi=b['x']+b['width']/2;z=b['base']
    v.box('Balcony_Slab',((lo+hi)/2,(front+y)/2,z-.12),(hi-lo+.15,y-front+.15,.24),v.M_CONCRETE,'Balconies',.02)
    v.box('Balcony_Paving',((lo+hi)/2,(front+y)/2,z+.012),(hi-lo+.08,y-front+.08,.04),v.M_STEPS,'Balconies')
    railing=b.get('railing',{});style=railing.get('style','unknown')
    if style=='unknown':style='metal' if profile=='rural-realistic' else 'stone'
    railing_styles.append(style)
    for name,a,end in [('Front',(lo,front),(hi,front)),('Left',(lo,front),(lo,y)),('Right',(hi,front),(hi,y))]:
        if style=='solid':components.solid_railing(v,f'Balcony_{i}_{name}',a,end,z,b['rail_height'])
        elif style=='metal':
            import realistic_materials as realistic
            if profile!='rural-realistic':rail_material=v.M_WINDOW
            realistic.metal_railing(v,f'Balcony_{i}_{name}',a,end,z,b['rail_height'],rail_material,railing.get('ornament'))
            metal_railing_segments+=1
        else:v.add_balustrade(f'Balcony_{i}_{name}',a,end,z,b['rail_height'])
    # Decorative end posts remain confined to the railing, not invented full-height columns.
    if style=='stone':
        for x in (lo,hi):v.pedestal('Railing_Post',x,front,z,z+b['rail_height']+.12)

for item in f.get('accessories',[]):
    if item['kind']=='air_conditioner':
        if profile!='rural-realistic':import realistic_materials as realistic
        mass=next(m for m in f['masses'] if m['id']==item['mass'])
        realistic.air_conditioner(v,item,components.wall_front(mass,structure,item['x'],item['bottom']+item['height']/2))

# New photo drafts carry an explicit support version. Historical saved specs
# retain their old geometry until the user generates a new photo draft.
entrance_objects=[];entrance_steps=0
if f.get('entrance_support_version')==1:
    sys.path.insert(0,str(HERE.parent))
    sys.path.insert(0,str(HERE.parents[3])); from rural_house_generator.backend.component_building.app.entrance import entrance_boxes
    for plan in f['entrances']:
        for item in entrance_boxes(plan,f['masses'],structure):
            ob=v.box(item['name'],item['center'],item['size'],v.M_STEPS,'Architectural_Details',.006)
            entrance_objects.append(ob)
            entrance_steps+=item['name']=='Entrance_Step'
else:
    for o in f['openings']:
        if o['kind']!='door':continue
        m=next(m for m in f['masses'] if m['id']==o['mass'])
        for i in range(3):
            v.box('Entrance_Step',(o['x'],m['front']-.2-i*.27,.045*(3-i)),
                (o['width']+.35,.35,.09*(3-i)),v.M_STEPS,'Architectural_Details',.012)

bpy.context.view_layer.update()
support_misses=0;support_error=0.
if entrance_objects:
    ev=[];ef=[]
    for ob in entrance_objects:
        n=len(ev);ev.extend(ob.matrix_world@p.co for p in ob.data.vertices)
        ef.extend(tuple(n+j for j in p.vertices) for p in ob.data.polygons)
    support_tree=BVHTree.FromPolygons(ev,ef,all_triangles=False)
    for plan in f['entrances']:
        if plan['kind']!='entrance':continue
        m=next(m for m in f['masses'] if m['id']==plan['mass'])
        y=components.wall_front(m,structure,plan['x'],plan['level'])-.35
        hit=support_tree.ray_cast(Vector((plan['x'],y,plan['level']+.2)),Vector((0,0,-1)),.5)[0]
        if hit is None:support_misses+=1
        else:support_error=max(support_error,abs(hit.z-plan['level']))
    if support_misses or support_error>.015:raise RuntimeError('门槛平台几何未通过支承检查')

# Check wall clearance BEFORE material batching and world-frame transformation.
if profile=='rural-realistic':
    # Keep the closed roof, ridges and fascia. PBR normals provide tile relief without
    # stacking almost coplanar sheets that create small repeated shadow artifacts.
    for ob in list(v.cs['Roof_Tiles'].objects):bpy.data.objects.remove(ob,do_unlink=True)
bpy.context.view_layer.update()
vertices=[];polys=[]
for ob in v.cs['Walls'].objects:
    if ob.type!='MESH':continue
    start=len(vertices);vertices.extend([ob.matrix_world@p.co for p in ob.data.vertices])
    polys.extend([tuple(start+j for j in p.vertices) for p in ob.data.polygons])
tree=BVHTree.FromPolygons(vertices,polys,all_triangles=False)
hits=0
for o in f['openings']:
    m=next(m for m in f['masses'] if m['id']==o['mass'])
    for k in (.2,.5,.8):
        z=o['bottom']+o['height']*k
        pt=Vector((o['x'],components.wall_front(m,structure,o['x'],z)-.5,z))
        if tree.ray_cast(pt,Vector((0,1,0)),.8)[0] is not None:hits+=1
if hits:raise RuntimeError(f'开口几何检查失败：{hits} 个采样点被墙体阻挡')
hidden_hits=0
for o in hidden:
    m=next(m for m in f['masses'] if m['id']==o['mass']);z=o['bottom']+o['height']/2
    if o['face']=='rear':point=Vector((o['x'],D+.5,z));direction=Vector((0,-1,0))
    elif o['face']=='left':point=Vector((m['x0']-.5,o['x'],z));direction=Vector((1,0,0))
    else:point=Vector((m['x1']+.5,o['x'],z));direction=Vector((-1,0,0))
    if tree.ray_cast(point,direction,.8)[0] is not None:hidden_hits+=1
if hidden_hits:raise RuntimeError(f'侧背开口检查失败：{hidden_hits}')

roof_checks=components.validate_roofs(roof_core_objects,f['masses'],H,D)

source=json.loads((HERE/'v3_parts.json').read_text('utf8'))
parts_text=(HERE/'v3_parts.py').read_text('utf8');nodes=ast.parse(parts_text)
hashes={n.name:hashlib.sha256(ast.get_source_segment(parts_text,n).encode()).hexdigest()
        for n in nodes.body if isinstance(n,ast.FunctionDef)}
verified=hashes==source['function_source_sha256']
if not verified:raise RuntimeError('V3 构件函数与提取基准不一致')

# Apply bevels/curves then consolidate material slots to reduce draw calls.
bpy.ops.object.select_all(action='DESELECT')
objects=[o for o in v.root.all_objects if o.type in ('MESH','CURVE')]
for ob in objects:ob.select_set(True)
bpy.context.view_layer.objects.active=objects[0]
bpy.ops.object.convert(target='MESH')
bpy.ops.object.join();model=bpy.context.object;model.name='Facade_V3_Components'
if profile=='v3-natural':
    from natural_materials import architectural_uv
    architectural_uv(model)
ao_device=None
if profile=='rural-realistic':
    realistic.metric_uv(model)
    model['surface_shading']='pbr-no-atlas-ao-v3'
render_device=None
triangles=sum(len(p.vertices)-2 for p in model.data.polygons)
material_count=len(model.data.materials)

if cfg.get('render') or cfg.get('presentation'):
    scene=bpy.context.scene;scene.render.resolution_x=1000;scene.render.resolution_y=1000
    scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast'
    scene.render.resolution_percentage=100;scene.world.color=(.35,.35,.35)
    scene.eevee.use_gtao=True;scene.eevee.gtao_distance=2;scene.eevee.gtao_factor=1.15
    bpy.ops.object.light_add(type='AREA',location=(W*.3,-D*1.5,H*1.6))
    light=bpy.context.object;light.data.energy=1700;light.data.size=12
    light.rotation_euler=(Vector((0,0,H/2))-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.light_add(type='AREA',location=(-W*.8,D*1.5,H*1.1))
    fill=bpy.context.object;fill.data.energy=1300;fill.data.size=12
    fill.rotation_euler=(Vector((0,D*.5,H/2))-fill.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.light_add(type='SUN');light=bpy.context.object
    light.rotation_euler=(math.radians(25),math.radians(-20),math.radians(-25));light.data.energy=1.8;light.data.angle=.12
    bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
    if profile=='rural-realistic':
        realistic.environment(scene);render_device=realistic.cycles_device(scene)
        scene.cycles.samples=int(cfg.get('render_samples',64));scene.cycles.use_denoising=True
        scene.cycles.use_adaptive_sampling=True
        scene.view_settings.view_transform='Filmic';scene.view_settings.look='Medium High Contrast'
        scene.view_settings.exposure=.25
        scene.render.resolution_x,scene.render.resolution_y=cfg.get('render_size',[1280,960])
        for lamp in [o for o in scene.objects if o.type=='LIGHT']:bpy.data.objects.remove(lamp,do_unlink=True)
        bpy.ops.object.light_add(type='SUN');lamp=bpy.context.object
        lamp.rotation_euler=(math.radians(28),math.radians(-20),math.radians(-30));lamp.data.energy=.65;lamp.data.angle=.15
        bpy.ops.mesh.primitive_plane_add(size=200,location=(0,D/2,-.085));ground=bpy.context.object
        ground.name='Presentation_Ground_Not_Exported';ground.data.materials.append(v.M_CONCRETE)
    if profile=='v3-original':
        scene.render.engine='BLENDER_WORKBENCH'
        shading=scene.display.shading;shading.light='STUDIO';shading.studiolight_rotate_z=0
        shading.studio_light='paint.sl';shading.color_type='MATERIAL'
        shading.show_shadows=True;shading.show_cavity=True;shading.cavity_type='BOTH'
        shading.curvature_ridge_factor=1.0;shading.curvature_valley_factor=1.0
        shading.background_type='WORLD';scene.world.color=(.055,.065,.075)
        scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast'
    poses=[
        ('front',(0,-30,H/2+f['roof']['rise']/2),(0,0,H/2+f['roof']['rise']/2),max(W+2,H+f['roof']['rise']+1)*1.07),
        ('oblique',(W*1.4,-D*2,H*1.2),(0,D*.25,H*.48),max(W,D,H)*1.75),
        ('rear',(W*.75,D*3,H*1.05),(0,D*.45,H*.48),max(W,D,H)*1.75)]
    def set_presentation_camera(position,target,scale):
        camera.location=position;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
        if profile=='rural-realistic':
            corners=[model.matrix_world@Vector(p) for p in model.bound_box]
            center=sum(corners,Vector())/8;camera.location+=center-Vector(target)
            camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
            bpy.context.view_layer.update();inv=camera.matrix_world.inverted();local=[inv@p for p in corners]
            aspect=scene.render.resolution_x/scene.render.resolution_y
            camera.data.ortho_scale=2*max(max(abs(p.x) for p in local),max(abs(p.y) for p in local)*aspect)*1.1
    for name,position,target,scale in poses if cfg.get('render') else [poses[1]]:
        set_presentation_camera(position,target,scale)
        scene.render.filepath=str(out.with_name('building-'+name+'.png'));bpy.ops.render.render(write_still=True)
    # Keep a usable original scene with packed textures, camera, lights and color management.
    _,position,target,scale=poses[1]
    set_presentation_camera(position,target,scale)
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(out.with_suffix('.blend')),compress=profile=='rural-realistic')

model['platform_building']=json.dumps({'metrics':s['metrics'],'platform':s.get('platform',{})});
frame=s['local_frame'];ex,ey=frame['front_tangent'];cx,cy=frame['front_midpoint']
world=Matrix(((ex,-ey,0,cx),(ey,ex,0,cy),(0,0,1,0),(0,0,0,1)))
model.matrix_world=world@model.matrix_world
bpy.ops.object.select_all(action='DESELECT');model.select_set(True);bpy.context.view_layer.objects.active=model
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,
    export_draco_mesh_compression_enable=cfg.get('web_compression',True),export_draco_mesh_compression_level=6,
    export_draco_position_quantization=16,export_draco_normal_quantization=12,export_draco_texcoord_quantization=14)
manifest={'engine':'facade-v2','wall_height':H,'openings':len(f['openings']),
    'arched_openings':sum(o['shape']=='arched' for o in f['openings']),
    'roof_count':len(f['masses']),'triangles':triangles,'materials':material_count,
    'bytes':out.stat().st_size,'primitives':material_count,'hole_count':0,'anchor':'source-origin',
    'opening_center_wall_hits':hits,'opening_floor_hits':0,
    'v3_function_source_verified':verified,'v3_source_sha256':source['source_sha256'],
    'assumptions':s['assumptions'],'side_openings':sum(o['face']!='rear' for o in hidden),
    'rear_doors':sum(o['face']=='rear' and o['kind']=='door' for o in hidden),
    'hidden_openings':len(hidden),'hidden_opening_wall_hits':hidden_hits,'render_profile':profile}
manifest.update(roof_checks)
manifest.update(ao_baked=False,ao_device=ao_device,render_device=render_device,
    columns=len(structure.get('columns',[])),porches=len(structure.get('porches',[])),
    roof_texture=f['roof'].get('texture'),eave_curve=f['roof'].get('eave_curve',0),albedo_baked=profile=='rural-realistic',
    solid_parapets=sum(b.get('railing',{}).get('style')=='solid' for b in f['balconies']),
    shutters=sum(o.get('subtype')=='shutter' for o in f['openings']),roof_details=len(f['roof'].get('details',[])),
    wall_finish='ceramic-panels' if profile=='rural-realistic' and f.get('wall_joints',True) else 'plaster' if profile=='rural-realistic' else 'v3-joints',
    wall_tile_size_m=[1.1,.68] if profile=='rural-realistic' and f.get('wall_joints',True) else None,
    wall_finish_measured=False,
    railing_style=railing_styles[0] if len(set(railing_styles))==1 else 'mixed' if railing_styles else 'none',
    air_conditioners=len(f.get('accessories',[])),surface_shading='pbr-no-atlas-ao-v3' if profile=='rural-realistic' else None,
    repeated_roof_panels_removed=profile=='rural-realistic',
    entrance_support_version=f.get('entrance_support_version',0),
    entrance_supports=sum(e['kind']=='entrance' for e in f.get('entrances',[])),
    balcony_doors=sum(e['kind']=='balcony' for e in f.get('entrances',[])),
    unresolved_upper_doors=sum(e['kind']=='unresolved-upper' for e in f.get('entrances',[])),
    entrance_steps=entrance_steps,entrance_support_ray_misses=support_misses,
    entrance_support_height_error_m=round(support_error,6),metal_railing_segments=metal_railing_segments,
    presentation_engine='CYCLES' if profile=='rural-realistic' else 'BLENDER_WORKBENCH' if profile=='v3-original' else 'BLENDER_EEVEE')
# Count images actually embedded in the exported GLB, not only Blender nodes.
import struct
data=out.read_bytes();length,kind=struct.unpack_from('<II',data,12)
gltf=json.loads(data[20:20+length]);manifest['embedded_images']=len(gltf.get('images',[]))
(out.parent/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf8')
