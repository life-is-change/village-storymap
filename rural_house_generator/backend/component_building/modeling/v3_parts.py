# Extracted V3 geometry helpers; no per-photo layout.
# Source: reference_villa_blender36_fixed_v3.py
# Source SHA256: e56ba8c8d1680330d9b8caf9d8795ce6c5645596b56791a1c8ee3b4566922b66
# Only the three-floor layout assertion is removed; function bodies are unchanged.
# -*- coding: utf-8 -*-
"""
Reference-inspired rural villa V3 (closed roof soffits, missing side return, model diagnostics).
Blender 3.6.23 standalone Python script (bpy only).

IMPORTANT:
- This is an INTERPRETATION of the villa in the supplied presentation
  screenshot, NOT automatic extraction or metric reconstruction.
- Dimensions and unseen facades are estimated / designed for this demo.
- This script CLEARS the active Blender scene. Save existing work first.

Blender > Scripting > Text > Open > this .py > Alt+P.
F12: render from the provided architectural camera.
For GLB: File > Export > glTF 2.0 (.glb/.gltf), choose GLB and selected
objects after selecting objects inside the Villa_ collections.
"""
import bpy
import math
import random
from mathutils import Vector

# ---------------------- EDITABLE PARAMETERS -----------------------
FLOOR_HEIGHT = 3.40
STORIES = 3
LEFT_WIDTH = 7.15               # left/back wing (meters)
RIGHT_WIDTH = 5.75              # right/front wing
BUILDING_DEPTH = 8.8
ROOF_COLOR = 'red'              # red, dark_red, gray
WALL_COLOR = 'white_stone'      # white_stone, warm_white
SHOW_BALUSTRADE = True
SHOW_FACADE_JOINTS = True
ADD_RENDER_CAMERA = True
AUTO_EXPORT_GLB = False
# 'preview' reduces roof tile tessellation; 'detailed' keeps V2 quality
ROOF_DETAIL = 'detailed'  # 'preview' or 'detailed'
GLB_OUTPUT = bpy.path.abspath('//reference_villa_blender36.glb')
# ------------------------------------------------------------------


H = FLOOR_HEIGHT * STORIES
RNG = random.Random(42)

# All x/y coordinates are meters. Front facade faces -Y.
LX0, LX1 = -6.25, 0.90
RX0, RX1 = 0.70, 6.45
LY0, LY1 = -3.25, 4.55
RY0, RY1 = -4.65, 4.55
T = 0.23  # exterior wall thickness

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name.startswith('Villa_'):
        bpy.data.collections.remove(c)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1050
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'Medium High Contrast'
try:
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 3.0
    scene.eevee.gtao_factor = 1.0
except Exception:
    pass

root = bpy.data.collections.new('Villa_00_Generated_Building')
scene.collection.children.link(root)
cs = {}
for name in ('Walls', 'Windows_Doors', 'Stone_Details', 'Roofs', 'Roof_Tiles',
             'Balconies', 'Balustrades', 'Architectural_Details'):
    c = bpy.data.collections.new('Villa_' + name)
    root.children.link(c)
    cs[name] = c
render_coll = bpy.data.collections.new('Villa_RENDER_ONLY')
scene.collection.children.link(render_coll)


def put(ob, group):
    target = cs[group]
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    target.objects.link(ob)
    return ob


def material(name, rgb, rough=0.70, metal=0.0):
    m = bpy.data.materials.new('Villa_' + name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    if shader:
        shader.inputs['Base Color'].default_value = (*rgb, 1)
        shader.inputs['Roughness'].default_value = rough
        shader.inputs['Metallic'].default_value = metal
    return m

if WALL_COLOR == 'white_stone':
    base_wall = (0.83, 0.83, 0.81)
else:
    base_wall = (0.86, 0.82, 0.73)
M_WALL = material('Ivory_Stone_Walls', base_wall, 0.82)
M_JOINT = material('Stone_Tile_Grout', (0.65, 0.65, 0.64), 0.95)
M_WHITE = material('White_Moldings', (0.93, 0.93, 0.90), 0.74)
M_SHADOW = material('Recessed_Window_Shadow', (0.09, 0.13, 0.17), 0.55)
M_GLASS = material('Blue_Grey_Tinted_Glass', (0.19, 0.27, 0.31), 0.16, 0.22)
M_WINDOW = material('Charcoal_Aluminium_Frames', (0.075, 0.081, 0.083), 0.35, 0.60)
M_DOOR = material('Mahogany_Entrance_Door', (0.28, 0.07, 0.035), 0.49)
M_STEPS = material('Light_Limestone', (0.74, 0.74, 0.70), 0.86)
M_CONCRETE = material('Concrete_Slabs', (0.66, 0.68, 0.67), 0.90)
M_DARK = material('Black_Ironwork', (0.08, 0.10, 0.10), 0.40, 0.60)
if ROOF_COLOR == 'gray':
    roof_palette = [(0.27,0.28,0.29),(0.32,0.32,0.32),(0.22,0.23,0.24)]
elif ROOF_COLOR == 'dark_red':
    roof_palette = [(0.49,0.15,0.10),(0.54,0.17,0.11),(0.44,0.13,0.10)]
else:
    roof_palette = [(0.72,0.25,0.15),(0.66,0.19,0.11),(0.76,0.30,0.17)]
M_ROOF = [material('Terracotta_Tile_%d' % i, col, 0.77)
          for i, col in enumerate(roof_palette)]
M_ROOF_SIDE = material('Tile_Roof_Underside', (0.45,0.24,0.18), 0.83)


def box(name, center, size, mat, group='Walls', bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.dimensions = tuple(max(0.001, s) for s in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    ob.data.materials.append(mat)
    put(ob, group)
    if bevel:
        b = ob.modifiers.new('Soft_Stone_Edge', 'BEVEL')
        b.width = bevel
        b.segments = 2
        n = ob.modifiers.new('Weighted_Normals', 'WEIGHTED_NORMAL')
        n.keep_sharp = True
    return ob


def mesh(name, verts, faces, mat, group):
    me = bpy.data.meshes.new(name+'_Geometry')
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    cs[group].objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def stroke(name, pts, radius, mat, group='Architectural_Details', bevel_resolution=2):
    cv = bpy.data.curves.new(name+'_Path', 'CURVE')
    cv.dimensions = '3D'
    cv.resolution_u = 2
    cv.bevel_depth = radius
    cv.resolution_u = 12
    cv.bevel_resolution = bevel_resolution
    spl = cv.splines.new('POLY')
    spl.points.add(len(pts)-1)
    for p,xyz in zip(spl.points, pts):
        p.co = (*xyz, 1)
    ob = bpy.data.objects.new(name, cv)
    cs[group].objects.link(ob)
    cv.materials.append(mat)
    return ob


def rect_skin(name, axis, coord, center, bottom, width, height,
              mat, group='Windows_Doors', depth=0.045):
    if axis == 'X':
        return box(name, (center,coord,bottom+height/2),
                   (width,depth,height),mat,group)
    return box(name, (coord,center,bottom+height/2),
               (depth,width,height),mat,group)


def wall_piece(name, xa, xb, coord, low_a, low_b, high_a, high_b, axis='X'):
    # Solid 3D wall strip with different lower/upper heights at its two edges.
    # Supports genuinely arched openings, not a painted arch on solid wall.
    if high_a <= low_a+1e-4 and high_b <= low_b+1e-4:
        return
    uvs = [(xa,low_a),(xb,low_b),(xb,high_b),(xa,high_a)]
    v = []
    for offset in (-T/2,T/2):
        for u,z in uvs:
            if axis=='X': v.append((u,coord+offset,z))
            else: v.append((coord+offset,u,z))
    f = [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),
         (2,6,7,3),(3,7,4,0)]
    return mesh(name, v, f, M_WALL, 'Walls')


def op(center,width,bottom,top,kind='window',arch=0.0):
    return dict(x=center,w=width,b=bottom,t=top,kind=kind,arch=arch)


def arch_top(o,x):
    if o['arch'] <= 0:
        return o['t']
    center=o['x']
    half=o['w']*0.5
    t=(x-center)/half
    return o['t']-o['arch']+o['arch']*math.sqrt(max(0.0,1-t*t))


def facade(name, axis, coord, left, right, openings, face=-1):
    # Split wall around ALL openings from ground to roof in one continuous mesh shell.
    # Multiple windows may share the same x-range on different floors.
    breaks = [left,right]
    for o in openings:
        a=o['x']-o['w']/2
        b=o['x']+o['w']/2
        assert a>left+0.002 and b<right-0.002, '%s: opening outside wall' % name
        breaks.extend([a,b])
        if o['arch']:
            breaks.extend([a+o['w']*i/24 for i in range(1,24)])
    breaks=sorted(set(round(x,6) for x in breaks))
    for k in range(len(breaks)-1):
        a,b=breaks[k:k+2]
        mid=(a+b)/2
        here=[o for o in openings if o['x']-o['w']/2+1e-5 < mid < o['x']+o['w']/2-1e-5]
        here.sort(key=lambda q:q['b'])
        prev_a,prev_b=0.0,0.0
        for oi,o in enumerate(here):
            bot=o['b']
            if bot > min(prev_a,prev_b)+1e-4:
                wall_piece(name+'_Wall_%d_%d'%(k,oi),a,b,coord,
                           prev_a,prev_b,bot,bot,axis)
            prev_a=arch_top(o,a)
            prev_b=arch_top(o,b)
        if H>min(prev_a,prev_b)+1e-4:
            wall_piece(name+'_Wall_%d_Top'%k,a,b,coord,
                       prev_a,prev_b,H,H,axis)
    for i,o in enumerate(openings):
        if o['kind']=='door':
            add_door(name+'_Door_'+str(i),axis,coord,o,face)
        elif o['arch']:
            add_arch_window(name+'_Arch_'+str(i),axis,coord,o,face)
        else:
            add_rect_window(name+'_Window_'+str(i),axis,coord,o,face)


def add_rect_window(name,axis,wall,o,face):
    u=o['x']; w=o['w']; z=o['b']; h=o['t']-z
    outside=wall+face*(T/2+0.035)
    rect_skin(name+'_Glass',axis,wall,u,z+0.07,w-0.14,h-0.13,M_GLASS)
    rect_skin(name+'_Dark_Interior',axis,wall-face*0.037,u,z+0.07,w-0.16,h-0.14,M_SHADOW,depth=0.02)
    for d in (-1,1):
        rect_skin(name+'_Jamb',axis,outside,u+d*(w/2-0.04),z,0.075,h,M_WINDOW)
    for zz in (z+0.04,o['t']-0.04):
        rect_skin(name+'_Frame',axis,outside,u,zz-0.035,w,0.074,M_WINDOW)
    rect_skin(name+'_Mullion',axis,outside,u,z+0.05,0.060,h-0.10,M_WINDOW)
    rect_skin(name+'_Transom',axis,outside,u,z+h*0.49,w-0.12,0.047,M_WINDOW)
    rect_skin(name+'_Sill',axis,outside+face*0.035,u,z-0.055,w+0.25,0.12,M_WHITE,
              'Stone_Details',depth=0.28)
    rect_skin(name+'_Head_Stone',axis,outside,u,o['t']+0.075,w+0.24,0.16,M_WHITE,
              'Stone_Details',depth=0.09)


def add_door(name,axis,wall,o,face):
    outside=wall+face*(T/2+0.04)
    z=o['b']; h=o['t']-z; u=o['x']; w=o['w']
    rect_skin(name+'_Mahogany_Panel',axis,wall,u,z+0.065,w-0.12,h-0.11,M_DOOR)
    for sign in (-1,1):
        rect_skin(name+'_Side_Frame',axis,outside,u+sign*(w/2-0.05),z,0.095,h,M_WINDOW)
    for height in (z+0.05,o['t']-0.05):
        rect_skin(name+'_TopBottom_Frame',axis,outside,u,height,w,0.10,M_WINDOW)
    for height in (z+0.65,z+1.37,z+2.03):
        if height<o['t']-0.10:
            rect_skin(name+'_Door_Detail',axis,outside+face*0.02,u,height,w-0.20,
                      0.038,M_DARK)
    rect_skin(name+'_Handle',axis,outside+face*0.1,u+w*0.28,z+1.15,0.08,0.16,M_WHITE)


def point(axis,coord,u,z,face_offset=0):
    if axis=='X': return (u,coord+face_offset,z)
    return (coord+face_offset,u,z)


def add_arch_window(name,axis,wall,o,face):
    w=o['w']; u=o['x']; lo=o['b']; hi=o['t']; rise=o['arch']
    shoulder=hi-rise
    glass_wall=wall+face*0.015
    # Meshed custom arched glass shaped to the exact arch opening.
    steps=36
    verts=[]; faces=[]
    for i in range(steps+1):
        x=u-w/2+0.062+(w-0.124)*i/steps
        verts.append(point(axis,glass_wall,x,lo+0.08))
        verts.append(point(axis,glass_wall,x,arch_top(o,x)-0.07))
    for i in range(steps):
        j=i*2
        faces.append((j,j+2,j+3,j+1))
    mesh(name+'_True_Arched_Glass',verts,faces,M_GLASS,'Windows_Doors')
    yoff=face*(T/2+0.045)
    # Exterior white stone reveals and dark inner frame follow a sampled ellipse.
    outline_outer=[point(axis,wall,u-w/2,lo,yoff),
                   point(axis,wall,u-w/2,shoulder,yoff)]
    outline_inner=[point(axis,wall,u-w/2+0.045,lo+0.04,yoff+face*0.025),
                   point(axis,wall,u-w/2+0.045,shoulder,yoff+face*0.025)]
    for i in range(steps+1):
        x=u-w/2+w*i/steps
        outline_outer.append(point(axis,wall,x,arch_top(o,x),yoff))
        xx=u-w/2+0.045+(w-0.09)*i/steps
        outline_inner.append(point(axis,wall,xx,arch_top(o,xx)-0.05,yoff+face*0.025))
    outline_outer += [point(axis,wall,u+w/2,lo,yoff)]
    outline_inner += [point(axis,wall,u+w/2-0.045,lo+0.04,yoff+face*0.025)]
    stroke(name+'_White_Stone_Arch_Trim',outline_outer,0.083,M_WHITE,'Stone_Details')
    stroke(name+'_Black_Metal_Arch_Frame',outline_inner,0.035,M_WINDOW,'Windows_Doors')
    for col in (-0.3,0,0.3):
        x=u+col*w
        top=arch_top(o,x)-0.05
        stroke(name+'_Vertical_Mullion',
               [point(axis,wall,x,lo+0.05,yoff),point(axis,wall,x,top,yoff)],
               0.025,M_WINDOW,'Windows_Doors',1)
    for z in [lo+1.28,lo+2.72,lo+4.20,lo+5.45]:
        if z<shoulder-0.06:
            stroke(name+'_Horizontal_Transom',
                   [point(axis,wall,u-w/2+0.07,z,yoff),
                    point(axis,wall,u+w/2-0.07,z,yoff)],
                   0.031,M_WINDOW,'Windows_Doors',1)
    rect_skin(name+'_Window_Sill',axis,wall+face*0.19,u,lo-0.055,w+0.22,
              0.10,M_WHITE,'Stone_Details',depth=0.24)


def add_balustrade(name,start,end,zbase,height=0.92,spacing=0.22):
    if not SHOW_BALUSTRADE:
        return
    # Input start/end are XY tuples: keep every direction vector three-dimensional.
    a=Vector((float(start[0]),float(start[1]),0.0))
    b=Vector((float(end[0]),float(end[1]),0.0))
    vec=b-a
    dist=vec.length
    if dist<0.25: return
    direction=vec.normalized()
    cross=Vector((-direction.y,direction.x,0.0))
    # Turned stone balusters are consolidated into ONE mesh per run.
    count=max(2,round(dist/spacing))
    verts=[]; faces=[]
    profile=[(0.0,0.068),(0.06,0.070),(0.12,0.052),(0.23,0.039),
             (0.34,0.065),(0.44,0.071),(0.55,0.042),(0.67,0.043),
             (0.78,0.064),(0.84,0.072)]
    profscale=(height-0.16)/0.84
    for k in range(1,count):
        center=a+direction*(dist*k/count)
        vi=len(verts)
        for h,r in profile:
            for v in range(10):
                theta=2*math.pi*v/10
                p=center + direction*(r*math.cos(theta)) + cross*(r*math.sin(theta))
                verts.append((p.x,p.y,zbase+0.07+h*profscale))
        for j in range(len(profile)-1):
            for v in range(10):
                q=vi+j*10+v;n=vi+j*10+(v+1)%10
                faces.append((q,n,n+10,q+10))
    mesh(name+'_Carved_Stone_Balusters',verts,faces,M_WHITE,'Balustrades')
    mid=(a+b)*0.5
    horizontal_x=abs(vec.x)>abs(vec.y)
    if horizontal_x:
        d=(dist+0.05,0.17,0.14)
    else:
        d=(0.17,dist+0.05,0.14)
    box(name+'_Bottom_Plinthe',(mid.x,mid.y,zbase+0.03),d,M_WHITE,'Balustrades',0.015)
    box(name+'_Top_Coping',(mid.x,mid.y,zbase+height+0.04),d,M_WHITE,'Balustrades',0.018)


def pedestal(name,x,y,zbase,top):
    box(name+'_Square_Base',(x,y,zbase+0.13),(0.41,0.41,0.26),M_WHITE,'Balconies',0.016)
    box(name+'_Column',(x,y,(zbase+top)/2),(0.23,0.23,top-zbase),M_WHITE,'Balconies',0.017)
    box(name+'_Capital',(x,y,top-0.10),(0.45,0.45,0.20),M_WHITE,'Balconies',0.014)


def roof_hip(name,x0,x1,y0,y1,eave,rise,overhang=0.42):
    x0-=overhang;x1+=overhang;y0-=overhang;y1+=overhang
    cx=(x0+x1)*0.5;cy=(y0+y1)*0.5
    rl=(x1-x0)*0.27
    ridge_a=(cx-rl,cy,eave+rise)
    ridge_b=(cx+rl,cy,eave+rise)
    corners=[(x0,y0,eave),(x1,y0,eave),
             (x1,y1,eave),(x0,y1,eave),ridge_a,ridge_b]
    faces=[(0,1,5,4),(3,4,5,2),(0,4,3),(1,2,5)]
    obj=mesh(name+'_Four_Hip_Planes',corners,faces,M_ROOF[0],'Roofs')
    # The old hip roof was a zero-thickness open sheet. Add a closed soffit
    # and perimeter skirt beneath its eaves. This caps visible open cavities
    # without requiring booleans or expensive roof-to-roof union operations.
    soffit_z=eave-0.18
    under=[(x0,y0,soffit_z),(x1,y0,soffit_z),
           (x1,y1,soffit_z),(x0,y1,soffit_z)]
    # Bottom face + four vertical bands below eave (separate mesh, shared mat).
    sv=under+corners[:4]
    sf=[(3,2,1,0),
        (0,1,5,4), (1,2,6,5), (2,3,7,6), (3,0,4,7)]
    mesh(name+'_Sealed_Eave_Soffit',sv,sf,M_ROOF_SIDE,'Roofs')
    for other in M_ROOF[1:]: obj.data.materials.append(other)
    for i,p in enumerate(obj.data.polygons):p.material_index=i%3
    # Roof courses over ALL FOUR slopes, stored in ONE mesh object. No external texture.
    # Flat hips are created above, and these thin individual facets sit slightly above
    # them, avoiding z-fighting and leaving the hip portions visibly tiled as well.
    vertices=[];tile_faces=[];shades=[]
    def lerp(p,q,t):
        return tuple(p[k]+(q[k]-p[k])*t for k in range(3))
    for side,corner_a,corner_b in ((0,corners[0],corners[1]),
                                   (1,corners[3],corners[2])):
        high_a=ridge_a;high_b=ridge_b
        rows, cols = (8, 18) if ROOF_DETAIL == 'preview' else (16, 36)
        def pos(u,v):
            return lerp(lerp(corner_a,corner_b,u),lerp(high_a,high_b,u),v)
        for r in range(rows):
            v0=r/rows;v1=(r+1)/rows
            for k in range(cols):
                u0=k/cols;u1=(k+1)/cols
                four=[pos(u0,v0),pos(u1,v0),pos(u1,v1),pos(u0,v1)]
                # Slight offset in Z and alternating courses give a subtle tiled relief.
                j=len(vertices)
                vertices.extend([(p[0],p[1],p[2]+0.028+0.011*(r%2)) for p in four])
                if side==0:
                    tile_faces.append((j,j+1,j+2,j+3))
                else:
                    tile_faces.append((j,j+3,j+2,j+1))
                shades.append(RNG.randrange(3))
    # Add tile tessellation to the triangular end hips too.
    # Triangle winding matches the outward-facing source roof panels.
    def tile_triangle(A,B,C,n=None):
        n = 8 if ROOF_DETAIL == 'preview' else 16
        A,B,C=(Vector(v) for v in (A,B,C))
        def on_face(i,j):
            p=A+(B-A)*(i/n)+(C-A)*(j/n)
            return (p.x,p.y,p.z+0.030)
        for i in range(n):
            for j in range(n-i):
                p0=on_face(i,j);p1=on_face(i+1,j);p2=on_face(i,j+1)
                base=len(vertices)
                vertices.extend((p0,p1,p2))
                tile_faces.append((base,base+1,base+2))
                shades.append(RNG.randrange(3))
                if i+j<n-1:
                    p3=on_face(i+1,j+1)
                    base=len(vertices)
                    vertices.extend((p1,p3,p2))
                    tile_faces.append((base,base+1,base+2))
                    shades.append(RNG.randrange(3))
    tile_triangle(corners[0],ridge_a,corners[3])
    tile_triangle(corners[1],corners[2],ridge_b)
    ob=mesh(name+'_Jointed_Red_Roof_Tile_Mesh',vertices,tile_faces,M_ROOF[0],'Roof_Tiles')
    for other in M_ROOF[1:]: ob.data.materials.append(other)
    for p,mindex in zip(ob.data.polygons,shades):p.material_index=mindex
    stroke(name+'_Ridge',[(ridge_a[0],ridge_a[1],ridge_a[2]+0.04),
                          (ridge_b[0],ridge_b[1],ridge_b[2]+0.04)],
           0.080,M_ROOF[1],'Roofs')
    for i,j in ((0,4),(3,4),(1,5),(2,5)):
        stroke(name+'_Hip_Ridge_Capping',[corners[i],corners[j]],0.080,M_ROOF[1],'Roofs')
    for edge in ((x0,x1,y0),(x0,x1,y1)):
        ax,bx,yy=edge
        box(name+'_Eaves_White_Band',((ax+bx)/2,yy,eave-0.095),
            (bx-ax,0.31,0.24),M_WHITE,'Roofs',0.012)
    for xx in (x0,x1):
        box(name+'_Side_Fascia',(xx,cy,eave-0.095),
            (0.27,y1-y0,0.24),M_WHITE,'Roofs',0.012)
