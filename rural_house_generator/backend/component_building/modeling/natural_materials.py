"""Small, embedded PBR surface maps; no external assets or shader-only nodes."""
import math
import random
from array import array
from pathlib import Path
import bpy


def surface_image(folder,name,mode):
    path=folder/(name+'.png')
    if path.exists():
        im=bpy.data.images.load(str(path),check_existing=True);im.colorspace_settings.name='Non-Color';return im
    size=128;pixels=array('f');rng=random.Random(921 if mode=='stone' else 112)
    for y in range(size):
        for x in range(size):
            grain=rng.uniform(-1,1)
            if mode=='rough':rgb=(1,.80+grain*.045,0)
            elif mode=='stone':rgb=(.5+grain*.045,.5+rng.uniform(-.045,.045),.995)
            else:rgb=(.5+.09*math.cos(x/size*math.tau*4)+grain*.01,.5+grain*.015,.99)
            pixels.extend((*rgb,1))
    im=bpy.data.images.new(name,width=size,height=size,alpha=False)
    im.colorspace_settings.name='Non-Color';im.pixels.foreach_set(pixels)
    im.filepath_raw=str(path);im.file_format='PNG';im.save();return im


def color(mat,rgb,rough,metal=0):
    mat.diffuse_color=(*rgb,1)
    p=mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*rgb,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal


def maps(mat,normal,rough=None,strength=.2):
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage');tex.image=normal
    n=nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=strength
    links.new(tex.outputs['Color'],n.inputs['Color']);links.new(n.outputs['Normal'],p.inputs['Normal'])
    if rough:
        tex=nodes.new('ShaderNodeTexImage');tex.image=rough
        separate=nodes.new('ShaderNodeSeparateRGB');links.new(tex.outputs['Color'],separate.inputs[0])
        links.new(separate.outputs['G'],p.inputs['Roughness'])


def apply_natural(v,folder,gray=False):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True)
    stone=surface_image(folder,'limestone-normal','stone');rough=surface_image(folder,'limestone-roughness','rough')
    roof=surface_image(folder,'roof-relief-normal','roof')
    color(v.M_WALL,(.66,.67,.645),.84);color(v.M_WHITE,(.79,.79,.755),.76)
    color(v.M_JOINT,(.49,.50,.48),.95);color(v.M_STEPS,(.59,.60,.56),.86)
    color(v.M_GLASS,(.085,.13,.16),.23,.12);color(v.M_WINDOW,(.045,.05,.052),.42,.25)
    maps(v.M_WALL,stone,rough,.17);maps(v.M_WHITE,stone,None,.09);maps(v.M_STEPS,stone,rough,.16)
    palette=[(.135,.17,.20),(.145,.18,.21),(.125,.16,.19)] if gray else [(.37,.135,.075),(.39,.145,.082),(.35,.125,.068)]
    for mat,rgb in zip(v.M_ROOF,palette):color(mat,rgb,.79);maps(mat,roof,None,.22)
    return {'normal_maps':2,'roughness_maps':1,'profile':'v3-natural'}


def architectural_uv(model):
    uv=model.data.uv_layers.new(name='FacadeMetricUV')
    uv.active_render=True;model.data.uv_layers.active=uv
    for polygon in model.data.polygons:
        normal=polygon.normal
        for li in polygon.loop_indices:
            p=model.data.vertices[model.data.loops[li].vertex_index].co
            if abs(normal.z)>.45:u,w=p.x,p.y
            elif abs(normal.y)>abs(normal.x):u,w=p.x,p.z
            else:u,w=p.y,p.z
            uv.data[li].uv=(u*.8,w*.8)
