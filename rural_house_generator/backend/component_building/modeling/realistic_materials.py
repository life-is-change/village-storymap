"""Exportable PBR surfaces, ceramic panels and metal architectural details."""
import json
import os
import math
from pathlib import Path
import bpy
from mathutils import Vector

ASSETS=Path(__file__).resolve().parents[1]/'data/source/realistic'


def image(name,color=False):
    path=ASSETS/name
    if not path.is_file():raise RuntimeError('缺少写实材质资源：'+name)
    im=bpy.data.images.load(str(path),check_existing=True)
    im.colorspace_settings.name='sRGB' if color else 'Non-Color'
    return im


def base(mat,color,rough,metal=0):
    mat.diffuse_color=(*color,1)
    p=mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return p


def surface(mat,asset,strength=.2,tint=(1,1,1)):
    p=base(mat,tint,.8);nodes=mat.node_tree.nodes;links=mat.node_tree.links
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='FacadeMetricUV'
    for kind,color in [('diff',True),('nor_gl',False),('arm',False)]:
        tex=nodes.new('ShaderNodeTexImage');tex.image=image(asset+'_'+kind+'_1k.jpg',color)
        if kind=='diff' and asset=='painted_plaster_wall':
            # Normalize the CC0 scan's albedo to clean off-white paint; keep its
            # low-amplitude spatial variation, with the source normal/roughness.
            import numpy as np
            source=tex.image;name='Clean_Offwhite_Plaster'
            derived=bpy.data.images.get(name)
            if derived is None:
                pixels=np.empty(len(source.pixels),dtype=np.float32);source.pixels.foreach_get(pixels)
                pixels=pixels.reshape((-1,4));pixels[:,:3]=.55+.30*pixels[:,:3]
                derived=bpy.data.images.new(name,width=source.size[0],height=source.size[1],alpha=False)
                derived.colorspace_settings.name='sRGB';derived.pixels.foreach_set(pixels.ravel())
                folder=Path(os.environ.get('RURAL_COMPONENT_CACHE', str(ASSETS.parents[2]/'.cache/materials')))/'rural-realistic';folder.mkdir(parents=True,exist_ok=True)
                derived.filepath_raw=str(folder/'clean-plaster-color.png');derived.file_format='PNG';derived.save()
            tex.image=derived
        links.new(uv.outputs['UV'],tex.inputs['Vector'])
        if kind=='diff':
            mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
            mix.inputs[2].default_value=(*tint,1);links.new(tex.outputs['Color'],mix.inputs[1]);links.new(mix.outputs[0],p.inputs['Base Color'])
        elif kind=='nor_gl':
            normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='FacadeMetricUV';normal.inputs['Strength'].default_value=strength
            links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs[0],p.inputs['Normal'])
        else:
            separate=nodes.new('ShaderNodeSeparateColor');separate.mode='RGB';links.new(tex.outputs['Color'],separate.inputs[0])
            links.new(separate.outputs['Green'],p.inputs['Roughness'])


def ceramic_surface(mat):
    """A seamless 4x4 atlas at V3 panel scale; grout is material relief, not AO."""
    import numpy as np
    size=512;atlas=(4.4,2.72);tile=(1.1,.68)
    x=(np.arange(size)+.5)*atlas[0]/size;y=(np.arange(size)+.5)*atlas[1]/size
    dx=np.minimum(x%tile[0],tile[0]-x%tile[0])[None,:]
    dy=np.minimum(y%tile[1],tile[1]-y%tile[1])[:,None]
    distance=np.minimum(dx,dy)
    fill=np.clip((distance-.003)/.004,0,1)
    rng=np.random.default_rng(731)
    shades=rng.uniform(-.018,.018,(4,4))
    variation=shades[(y/tile[1]).astype(int)[:,None],(x/tile[0]).astype(int)[None,:]]
    level=(.72+variation)*fill+.36*(1-fill)
    color=np.stack((level,level*.995,level*.975),axis=-1)
    height=np.clip((distance-.0045)/.004,0,1)*.0012
    gy,gx=np.gradient(height,atlas[1]/size,atlas[0]/size)
    normals=np.stack((-gx,-gy,np.ones_like(gx)),axis=-1)
    normals/=np.linalg.norm(normals,axis=-1,keepdims=True)
    roughness=(.35+variation*1.2)*fill+.88*(1-fill)
    orm=np.stack((np.ones_like(fill),roughness,np.zeros_like(fill)),axis=-1)
    folder=Path(os.environ.get('RURAL_COMPONENT_CACHE', str(ASSETS.parents[2]/'.cache/materials')))/'ceramic-v1';folder.mkdir(parents=True,exist_ok=True)
    p=base(mat,(1,1,1),.35);nodes=mat.node_tree.nodes;links=mat.node_tree.links
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='FacadeMetricUV'
    for kind,rgb,srgb in [('Color',color,True),('Normal',normals*.5+.5,False),('ORM',orm,False)]:
        name='Facade_Ceramic_'+kind
        im=bpy.data.images.new(name,width=size,height=size,alpha=False)
        im.colorspace_settings.name='sRGB' if srgb else 'Non-Color'
        rgba=np.concatenate((rgb,np.ones((size,size,1))),axis=-1).astype(np.float32)
        im.pixels.foreach_set(rgba.ravel());im.filepath_raw=str(folder/(name+'.png'));im.file_format='PNG';im.save()
        # Reopen the saved source so native Blender and GLB use identical pixels.
        path=im.filepath_raw;bpy.data.images.remove(im)
        im=bpy.data.images.load(path,check_existing=False);im.name=name
        im.colorspace_settings.name='sRGB' if srgb else 'Non-Color'
        tex=nodes.new('ShaderNodeTexImage');tex.image=im
        links.new(uv.outputs['UV'],tex.inputs['Vector'])
        if kind=='Color':
            mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
            mix.inputs[2].default_value=(1,1,1,1);links.new(tex.outputs['Color'],mix.inputs[1]);links.new(mix.outputs[0],p.inputs['Base Color'])
        elif kind=='Normal':
            normal=nodes.new('ShaderNodeNormalMap');normal.uv_map='FacadeMetricUV';normal.inputs['Strength'].default_value=1
            links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs[0],p.inputs['Normal'])
        else:
            # The installed glTF exporter recognizes Separate Color's Green socket;
            # legacy Separate RGB is wrongly gathered as the R channel (constant 1).
            separate=nodes.new('ShaderNodeSeparateColor');separate.mode='RGB'
            links.new(tex.outputs['Color'],separate.inputs[0]);links.new(separate.outputs['Green'],p.inputs['Roughness'])
    mat['wall_finish']='ceramic-panels';mat['tile_size_m']=tile;mat['tile_atlas_m']=atlas


def bake_albedo(mat,target,*,neutralize=False):
    """Bake photo tint into standard image pixels, shared by native and glTF."""
    import hashlib
    import numpy as np
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    tex=next((n for n in nodes if n.type=='TEX_IMAGE' and n.image and n.image.colorspace_settings.name=='sRGB'),None)
    if tex is None:return
    source=tex.image;key=hashlib.sha256((source.name+str(list(target))+str(neutralize)+'linear-v3').encode()).hexdigest()[:12]
    name=source.name+'_Tint_'+key;derived=bpy.data.images.get(name)
    if derived is None:
        pixels=np.empty(len(source.pixels),dtype=np.float32);source.pixels.foreach_get(pixels);pixels=pixels.reshape((-1,4))
        from color_space import tint_linear_pixels
        pixels=tint_linear_pixels(pixels,target,neutralize=neutralize)
        derived=bpy.data.images.new(name,width=source.size[0],height=source.size[1],alpha=False)
        derived.colorspace_settings.name='sRGB';derived.pixels.foreach_set(pixels.ravel())
        folder=Path(os.environ.get('RURAL_COMPONENT_CACHE', str(ASSETS.parents[2]/'.cache/materials')))/'photo-albedo-v2';folder.mkdir(parents=True,exist_ok=True)
        path=folder/(name+'.png');derived.filepath_raw=str(path);derived.file_format='PNG';derived.save()
        bpy.data.images.remove(derived);derived=bpy.data.images.load(str(path),check_existing=False);derived.name=name
        derived.colorspace_settings.name='sRGB'
    tex.image=derived;links.new(tex.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    mat['albedo_baked']=True;mat['target_srgb']=list(target)


def roof_surface(mat,kind):
    """Separate gray-wave tile / corrugated metal from the red clay scan."""
    if kind=='clay_tiles':surface(mat,'clay_roof_tiles_02',.7);return
    import numpy as np
    size=512;xx,yy=np.meshgrid((np.arange(size)+.5)/size,(np.arange(size)+.5)/size)
    waves=12 if kind=='gray_wave_tile' else 8
    height=.004*np.cos(xx*waves*np.pi*2)
    seams=np.minimum((yy*8)%1,1-(yy*8)%1)<.035 if kind=='gray_wave_tile' else np.zeros_like(xx,dtype=bool)
    height-=seams*.0015
    gy,gx=np.gradient(height,2.5/size,2.5/size);normal=np.stack((-gx,-gy,np.ones_like(gx)),axis=-1)
    normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
    shade=.5+.018*np.cos(xx*waves*np.pi*2)-seams*.05
    color=np.stack((shade,shade,shade),axis=-1)
    rough=np.full_like(xx,.62 if kind=='gray_wave_tile' else .40)+seams*.14
    orm=np.stack((np.ones_like(xx),rough,np.zeros_like(xx)),axis=-1)
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=base(mat,(1,1,1),.62)
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='FacadeMetricUV'
    for label,pixels,srgb in [('Color',color,True),('Normal',normal*.5+.5,False),('ORM',orm,False)]:
        name=kind+'_'+label;im=bpy.data.images.get(name)
        if im is None:
            im=bpy.data.images.new(name,width=size,height=size,alpha=False);im.colorspace_settings.name='sRGB' if srgb else 'Non-Color'
            rgba=np.concatenate((pixels,np.ones((size,size,1))),axis=-1).astype(np.float32);im.pixels.foreach_set(rgba.ravel())
            folder=Path(os.environ.get('RURAL_COMPONENT_CACHE', str(ASSETS.parents[2]/'.cache/materials')))/'roof-components-v1';folder.mkdir(parents=True,exist_ok=True)
            path=folder/(name+'.png');im.filepath_raw=str(path);im.file_format='PNG';im.save();bpy.data.images.remove(im)
            im=bpy.data.images.load(str(path),check_existing=False);im.name=name;im.colorspace_settings.name='sRGB' if srgb else 'Non-Color'
        tex=nodes.new('ShaderNodeTexImage');tex.image=im;links.new(uv.outputs['UV'],tex.inputs['Vector'])
        if label=='Color':links.new(tex.outputs['Color'],p.inputs['Base Color'])
        elif label=='Normal':
            normal_node=nodes.new('ShaderNodeNormalMap');normal_node.uv_map='FacadeMetricUV'
            links.new(tex.outputs['Color'],normal_node.inputs['Color']);links.new(normal_node.outputs[0],p.inputs['Normal'])
        else:
            sep=nodes.new('ShaderNodeSeparateColor');sep.mode='RGB';links.new(tex.outputs['Color'],sep.inputs[0]);links.new(sep.outputs['Green'],p.inputs['Roughness'])
    mat['roof_surface']=kind


def apply_materials(v,gray=False,appearance=None,tiled=True,roof_texture=None):
    if tiled:ceramic_surface(v.M_WALL)
    else:surface(v.M_WALL,'painted_plaster_wall',.12,(.96,.95,.91))
    for mat in v.M_ROOF:roof_surface(mat,roof_texture or ('gray_wave_tile' if gray else 'clay_tiles'))
    base(v.M_WHITE,(.74,.73,.69),.68);base(v.M_JOINT,(.5,.49,.46),.9)
    base(v.M_STEPS,(.27,.28,.27),.64);base(v.M_CONCRETE,(.53,.52,.49),.86)
    base(v.M_WINDOW,(.04,.047,.05),.32,.72)
    base(v.M_DOOR,(.035,.04,.042),.35,.55)
    base(v.M_SHADOW,(.018,.022,.023),1)
    p=base(v.M_GLASS,(.48,.54,.57),.13)
    p.inputs['Transmission'].default_value=.7;p.inputs['IOR'].default_value=1.46
    v.M_GLASS.use_screen_refraction=True
    rail=bpy.data.materials.new('Rural_Black_Powder_Coated_Metal');rail.use_nodes=True;base(rail,(.025,.031,.034),.38,.65)
    appearance=appearance or {}
    bake_albedo(v.M_WALL,appearance.get('wall_srgb',[.85,.84,.81]))
    roof_colour=appearance.get('roof_srgb',[.24,.29,.34] if gray else [.58,.29,.18])
    for mat in v.M_ROOF:bake_albedo(mat,roof_colour,neutralize=True)
    socle=appearance.get('zones',{}).get('socle_srgb')
    if socle:base(v.M_STEPS,socle,.62)
    return rail


def metal_railing(v,name,a,b,z,height,mat,ornament='none'):
    A=Vector((a[0],a[1],z));B=Vector((b[0],b[1],z));length=(B-A).length
    for level,radius in [(0.10,.016),(height-.20,.014),(height,.025)]:
        v.stroke(name+'_Horizontal',[tuple(A+Vector((0,0,level))),tuple(B+Vector((0,0,level)))],radius,mat,'Balustrades')
    count=max(2,math.ceil(length/.15))
    for i in range(count+1):
        p=A.lerp(B,i/count)
        v.stroke(name+'_Vertical',[tuple(p+Vector((0,0,.10))),tuple(p+Vector((0,0,height)))],.012,mat,'Balustrades')
    for p in (A,B):v.stroke(name+'_Post',[tuple(p),tuple(p+Vector((0,0,height+.025)))],.026,mat,'Balustrades')
    if ornament=='medallion' and length>.8:
        gold=bpy.data.materials.get('Rural_Railing_Brass')
        if gold is None:
            gold=bpy.data.materials.new('Rural_Railing_Brass');gold.use_nodes=True;base(gold,(.31,.22,.09),.4,.8)
        direction=(B-A).normalized();up=Vector((0,0,1));r=min(.24,height*.27)
        for i in range(max(1,round(length/1.6))):
            center=A.lerp(B,(i+.5)/max(1,round(length/1.6)))+up*(height*.52)
            v.stroke(name+'_Medallion',[tuple(center+direction*(r*math.cos(t*math.tau/40))+up*(r*math.sin(t*math.tau/40))) for t in range(41)],.012,gold,'Balustrades')


def air_conditioner(v,item,wall):
    x,z,w,h,d=item['x'],item['bottom'],item['width'],item['height'],item['depth']
    y=wall-v.T/2-d/2-.06
    v.box('AC_Outdoor_Casing',(x,y,z+h/2),(w,d,h),v.M_WHITE,'Architectural_Details',.025)
    front=y-d/2-.008;radius=min(h*.36,w*.26)
    center=Vector((x-w*.16,front,z+h*.52))
    for i in range(4):
        r=radius*(i+1)/4
        v.stroke('AC_Fan_Grille',[tuple(center+Vector((r*math.cos(t*math.tau/36),0,r*math.sin(t*math.tau/36)))) for t in range(37)],.007,v.M_WINDOW,'Architectural_Details',1)
    for angle in range(0,180,30):
        delta=Vector((radius*math.cos(math.radians(angle)),0,radius*math.sin(math.radians(angle))))
        v.stroke('AC_Fan_Spoke',[tuple(center-delta),tuple(center+delta)],.006,v.M_WINDOW,'Architectural_Details',1)
    for i in range(7):
        v.box('AC_Side_Vent',(x+w*.28,front,z+h*(.2+i*.095)),(w*.18,.012,.012),v.M_WINDOW,'Architectural_Details')
    for xx in (x-w*.3,x+w*.3):
        v.stroke('AC_Mount',[tuple((xx,wall-v.T/2-.02,z+.1)),tuple((xx,wall-v.T/2-.02,z-.08)),tuple((xx,front,z-.08))],.025,v.M_WINDOW,'Architectural_Details',1)


def metric_uv(model):
    for old in list(model.data.uv_layers):model.data.uv_layers.remove(old)
    uv=model.data.uv_layers.new(name='FacadeMetricUV');uv.active_render=True
    for face in model.data.polygons:
        mat=model.data.materials[face.material_index]
        name=mat.name.lower();n=face.normal
        roof='roof' in name and abs(n.z)>.2
        if roof:
            u=Vector((1,0,0)) if abs(n.x)<abs(n.y) else Vector((0,1,0))
            w=n.cross(u).normalized();scale=1/2.5
        elif abs(n.z)>.7:u=Vector((1,0,0));w=Vector((0,1,0));scale=.5
        else:u=Vector((1,0,0)) if abs(n.y)>abs(n.x) else Vector((0,1,0));w=Vector((0,0,1));scale=.5
        for index in face.loop_indices:
            p=model.data.vertices[model.data.loops[index].vertex_index].co
            if mat.get('wall_finish')=='ceramic-panels':
                a,b=mat['tile_atlas_m'];uv.data[index].uv=(p.dot(u)/a,p.dot(w)/b)
            else:uv.data[index].uv=(p.dot(u)*scale,p.dot(w)*scale)


def cycles_device(scene):
    scene.render.engine='CYCLES';pref=bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX','CUDA'):
        try:
            pref.compute_device_type=kind;pref.get_devices();devices=[d for d in pref.devices if d.type==kind]
            if devices:
                for d in pref.devices:d.use=d in devices
                scene.cycles.device='GPU';return kind+': '+devices[0].name
        except (TypeError,RuntimeError):pass
    scene.cycles.device='CPU';return 'CPU'


def environment(scene):
    world=bpy.data.worlds.new('Rural_Overcast_HDRI');scene.world=world;world.use_nodes=True
    nodes=world.node_tree.nodes;links=world.node_tree.links
    env=nodes.new('ShaderNodeTexEnvironment');env.image=image('overcast_soil_1k.hdr')
    links.new(env.outputs['Color'],nodes.get('Background').inputs['Color'])
    nodes.get('Background').inputs['Strength'].default_value=.8
    return world
