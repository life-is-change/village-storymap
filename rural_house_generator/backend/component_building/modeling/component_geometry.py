"""Stable builders for validated components; V3 source functions stay intact."""
from mathutils import Vector


def wall_front(m,structure,x,z):
    values=[p['recess'] for p in structure.get('porches',[]) if p['mass']==m['id'] and p['x0']-1e-5<=x<=p['x1']+1e-5 and p['bottom']-1e-5<=z<=p['top']+1e-5]
    return m['front']+max(values,default=0)


def front_facade(v,name,m,ops,structure):
    porches=[p for p in structure.get('porches',[]) if p['mass']==m['id']]
    if not porches and not any(o.get('subtype') for o in ops):
        v.facade(name,'X',m['front'],m['x0'],m['x1'],ops,-1);return
    breaks=[m['x0'],m['x1']]+[x for p in porches for x in (p['x0'],p['x1'])]
    levels=sorted(set([0,v.H]+[z for p in porches for z in (p['bottom'],p['top'])]))
    for o in ops:
        a=o['x']-o['w']/2;breaks.extend([a,a+o['w']])
        if o['arch']:breaks.extend([a+o['w']*i/24 for i in range(1,24)])
    breaks=sorted(set(round(x,6) for x in breaks))
    for a,b in zip(breaks,breaks[1:]):
        if b-a<1e-5:continue
        mid=(a+b)/2;here=sorted([o for o in ops if o['x']-o['w']/2<mid<o['x']+o['w']/2],key=lambda o:o['b'])
        intervals=[];lo_a=lo_b=0
        for o in here:
            intervals.append((lo_a,lo_b,o['b'],o['b']));lo_a=v.arch_top(o,a);lo_b=v.arch_top(o,b)
        intervals.append((lo_a,lo_b,v.H,v.H))
        for low_a,low_b,high_a,high_b in intervals:
            for bottom,top in zip(levels,levels[1:]):
                aa=max(bottom,low_a);bb=max(bottom,low_b);cc=min(top,high_a);dd=min(top,high_b)
                if max(cc-aa,dd-bb)<1e-5:continue
                y=wall_front(m,structure,mid,(max(aa,bb)+min(cc,dd))/2)
                v.wall_piece(name+'_Graph_Wall',a,b,y,aa,bb,cc,dd)
    for o in ops:
        y=wall_front(m,structure,o['x'],(o['b']+o['t'])/2)
        if o.get('subtype')=='passage':continue
        if o.get('subtype')=='shutter':shutter(v,name+'_Shutter',y,o)
        elif o.get('subtype')=='glazed_door':glazed_door(v,name+'_Balcony_Glazed_Door',y,o)
        elif o['kind']=='door':v.add_door(name+'_Door','X',y,o,-1)
        elif o['arch']:v.add_arch_window(name+'_Arch','X',y,o,-1)
        else:v.add_rect_window(name+'_Window','X',y,o,-1)
    # Use the actual stepped front profile, not one overlapping return per zone.
    # Local balcony overrides can overlap a pre-existing whole-height colonnade.
    for x in sorted(set(x for p in porches for x in (p['x0'],p['x1']))):
        for bottom,top in zip(levels,levels[1:]):
            z=(bottom+top)/2
            left=wall_front(m,structure,x-.0001,z) if x>m['x0'] else m['front']
            right=wall_front(m,structure,x+.0001,z) if x<m['x1'] else m['front']
            if abs(left-right)>.00001:
                v.wall_piece(name+'_Porch_Return',min(left,right),max(left,right),x,bottom,bottom,top,top,'Y')


def glazed_door(v,name,y,o):
    z,h,u,w=o['b'],o['t']-o['b'],o['x'],o['w'];front=y-v.T/2-.04
    v.rect_skin(name+'_Glass','X',y,u,z+.05,w-.12,h-.1,v.M_GLASS)
    v.rect_skin(name+'_Interior','X',y+.04,u,z+.05,w-.14,h-.12,v.M_SHADOW,depth=.02)
    for x in (u-w/2+.035,u,u+w/2-.035):
        v.rect_skin(name+'_Vertical_Frame','X',front,x,z,.065,h,v.M_WINDOW)
    for level in (z+.035,z+h-.035,z+h*.82):
        v.rect_skin(name+'_Frame','X',front,u,level,w,.065,v.M_WINDOW)
    v.rect_skin(name+'_Threshold','X',front,u,z-.025,w+.10,.06,v.M_STEPS,depth=.20)
    for x in (u-.10,u+.10):v.rect_skin(name+'_Handle','X',front-.035,x,z+min(1.,h*.45),.035,.22,v.M_WINDOW,depth=.035)


def shutter(v,name,y,o):
    mat=v.material('Roller_Shutter_Aluminium',(.42,.44,.44),.52,.6)
    z=o['b'];h=o['t']-z;front=y-v.T/2-.035
    v.rect_skin(name+'_Panel','X',y,o['x'],z,o['w'],h,mat)
    count=max(2,round(h/.095))
    for i in range(count):v.box(name+'_Slat',(o['x'],front,z+(i+.5)*h/count),(o['w']-.06,.045,.028),mat,'Windows_Doors',.005)
    for sign in [-1,1]:v.rect_skin(name+'_Track','X',front,o['x']+sign*(o['w']/2-.025),z,.07,h,v.M_WINDOW)


def porch_frames(v,structure,masses,ops_by_mass,fh):
    for c in structure.get('columns',[]):
        m=next(m for m in masses if m['id']==c['mass'])
        v.box('Porch_Column',(c['x'],m['front'],c['bottom']+c['height']/2),(c['width'],c['depth'],c['height']),v.M_WHITE,'Architectural_Details',.014)
        for z in (c['bottom']+.06,c['bottom']+c['height']-.06):v.box('Porch_Column_Cap',(c['x'],m['front'],z),(c['width']+.06,c['depth']+.06,.12),v.M_WHITE,'Architectural_Details',.01)
    for p in structure.get('porches',[]):
        m=next(m for m in masses if m['id']==p['mass']);ops=ops_by_mass[p['mass']]
        for z in [p['bottom']]+[i*fh for i in range(1,7) if p['bottom']<i*fh<=p['top']]:
            crossing=[o for o in ops if o['b']+.04<z<o['t']-.04]
            breaks=sorted(set([p['x0'],p['x1']]+[max(p['x0'],min(p['x1'],x)) for o in crossing for x in (o['x']-o['w']/2-.04,o['x']+o['w']/2+.04)]))
            for a,b in zip(breaks,breaks[1:]):
                if b-a<.02 or any(o['x']-o['w']/2-.04<(a+b)/2<o['x']+o['w']/2+.04 for o in crossing):continue
                v.box('Porch_Floor',((a+b)/2,m['front']+p['recess']/2,z-.04),(b-a,p['recess']+.12,.12),v.M_CONCRETE,'Architectural_Details',.008)
        v.box('Porch_Roof_Beam',((p['x0']+p['x1'])/2,m['front'],p['top']-.10),(p['x1']-p['x0'],.30,.20),v.M_WHITE,'Architectural_Details',.01)


def solid_railing(v,name,a,b,z,height):
    A=Vector((a[0],a[1],z));B=Vector((b[0],b[1],z));d=B-A;length=d.length
    if length<.05:return
    dims=(length,.15,height) if abs(d.x)>abs(d.y) else (.15,length,height)
    cap=(length+.04,.20,.07) if abs(d.x)>abs(d.y) else (.20,length+.04,.07)
    v.box(name+'_Solid_Parapet',tuple((A+B)/2+Vector((0,0,height/2))),dims,v.M_WALL,'Balustrades',.012)
    v.box(name+'_Parapet_Coping',tuple((A+B)/2+Vector((0,0,height))),cap,v.M_WHITE,'Balustrades',.012)


def validate_balcony_floors(v,balconies,dimensions):
    """Ray-check the actual continuous walking slab before objects are joined."""
    from mathutils.bvhtree import BVHTree
    import bpy
    bpy.context.view_layer.update()
    verts=[];faces=[]
    for ob in v.cs['Balconies'].objects:
        if ob.type!='MESH':continue
        start=len(verts);verts.extend(ob.matrix_world@p.co for p in ob.data.vertices)
        faces.extend(tuple(start+j for j in p.vertices) for p in ob.data.polygons)
    tree=BVHTree.FromPolygons(verts,faces,all_triangles=False) if verts else None
    samples=0
    for b,d in zip(balconies,dimensions):
        if not d['depth_version']:continue
        for t in (.05,.25,.5,.75,.95):
            y=d['rail_front']+(d['glass_face']-d['rail_front'])*t
            hit=tree.ray_cast(Vector((b['x'],y,b['base']+.18)),Vector((0,0,-1)),.35)[0] if tree else None
            if hit is None or abs(hit.z-b['base'])>.07:
                raise RuntimeError('阳台连续楼板支承检查失败')
            samples+=1
    return samples


def sealed_core(v,name,shell):
    from roof_shell import audit_shell
    audit=audit_shell(shell)
    if audit['nonmanifold_edges'] or audit['winding_conflicts'] or audit['signed_volume']<=0:
        raise RuntimeError('Roof shell is open or inward facing')
    ob=v.mesh(name,shell['vertices'],shell['faces'],v.M_ROOF[0],'Roofs')
    for mat in [v.M_ROOF[1],v.M_ROOF[2],v.M_ROOF_SIDE]:ob.data.materials.append(mat)
    slots={'tile0':0,'tile1':1,'tile2':2,'underside':3}
    for p,tag in zip(ob.data.polygons,shell['materials']):p.material_index=slots[tag]
    return ob


def hip(v,name,m,H,roof,D):
    import bpy
    from roof_shell import build_roof_shell
    shell=build_roof_shell('hip',m,D,H,roof,v.T)
    v.roof_hip(name,m['x0'],m['x1'],m['front'],D,shell['eave_z'],roof['rise'],shell['overhang_effective'])
    # V3 tile detail and capping stay intact. Replace its separate open panels
    # with one consistently wound, welded closed core; source V3 is unchanged.
    for suffix in ['_Four_Hip_Planes','_Sealed_Eave_Soffit']:
        ob=bpy.data.objects.get(name+suffix)
        if ob:bpy.data.objects.remove(ob,do_unlink=True)
    return sealed_core(v,name+'_Closed_Roof_Core',shell)


def gable(v,m,H,roof,D):
    from roof_shell import build_roof_shell
    shell=build_roof_shell('gable',m,D,H,roof,v.T)
    ob=sealed_core(v,'Graph_Gable_Closed_Core',shell)
    # Preserve an architectural cornice around the closed roof, rather than a
    # floating thin sheet. The gable ends share vertices with all roof slopes.
    over=shell['overhang_effective'];x0=m['x0']-over;x1=m['x1']+over
    y0=m['front']-over;y1=D+over;z=shell['eave_z'];curve=roof.get('eave_curve',0)
    for y in [y0,y1]:
        v.stroke('Graph_Eave',[(x0+(x1-x0)*i/32,y,z-.09+curve*abs(2*i/32-1)**8) for i in range(33)],.10,v.M_WHITE,'Roofs',1)
    for x in [x0,x1]:
        for ya,yb in [(y0,(y0+y1)/2),((y0+y1)/2,y1)]:
            pts=[]
            for i in range(17):
                y=ya+(yb-ya)*i/16;slope=1-abs((y-(y0+y1)/2)/((y1-y0)/2))
                pts.append((x,y,z+roof['rise']*slope+curve*(1-slope)**3))
            v.stroke('Graph_Gable_Capping',pts,.055,v.M_ROOF_SIDE,'Roofs',1)
    v.stroke('Graph_Ridge',[(x0,(y0+y1)/2,z+roof['rise']),(x1,(y0+y1)/2,z+roof['rise'])],.065,v.M_ROOF[1],'Roofs',1)
    return ob


def validate_roofs(objects,masses,H,D):
    from mathutils.bvhtree import BVHTree
    from roof_shell import audit_shell
    verts=[];faces=[];checks=[]
    for ob in objects:
        vv=[tuple(ob.matrix_world@p.co) for p in ob.data.vertices]
        ff=[tuple(p.vertices) for p in ob.data.polygons]
        check=audit_shell({'vertices':vv,'faces':ff});checks.append(check)
        if check['nonmanifold_edges'] or check['winding_conflicts'] or check['signed_volume']<=0:
            raise RuntimeError('Roof core is not closed/outward')
        n=len(verts);verts.extend(vv);faces.extend(tuple(n+i for i in p) for p in ff)
    tree=BVHTree.FromPolygons(verts,faces,all_triangles=False)
    misses=normal_failures=samples=0;max_gap=0.
    for m in masses:
        a,b=m['x0']+.08,m['x1']-.08;c,d=m['front']+.08,D-.08
        pts=[(a,c),(b,c),(b,d),(a,d),((a+b)/2,c),((a+b)/2,d),(a,(c+d)/2),(b,(c+d)/2)]
        for x,y in pts:
            samples+=1;hit,normal,_,_=tree.ray_cast(Vector((x,y,H-.08)),Vector((0,0,1)),.5)
            if hit is None or hit.z>H+.001:misses+=1
            if hit is not None:
                max_gap=max(max_gap,hit.z-H)
                if normal.z>-.99:normal_failures+=1
    if misses or normal_failures:raise RuntimeError(f'Roof bearing failed: {misses} gaps/misses, {normal_failures} inward normals')
    return {'roof_geometry_version':2,'roof_shell_checks':checks,'roof_bearing_samples':samples,
            'roof_bearing_misses':misses,'roof_bearing_normal_failures':normal_failures,
            'roof_max_wall_gap_m':max_gap,'roof_bearing_overlap_m':.02}


def roof_details(v,roof,H,D):
    for c in roof.get('details',[]):
        from roof_shell import EAVE_ABOVE_WALL
        x=c['x'];w=c['width'];d=c['depth'];h=c['height']
        z=H+.22 if roof['type']=='flat' else H+EAVE_ABOVE_WALL+roof['rise']
        v.box('Ridge_Vent_Dark_Core',(x,D/2,z+h/2),(w,d,h),v.M_SHADOW,'Architectural_Details',.01)
        for sign in [-1,1]:v.box('Ridge_Vent_Post',(x+sign*(w/2-.045),D/2-d/2-.025,z+h/2),(.09,.09,h),v.M_WHITE,'Architectural_Details',.01)
        v.box('Ridge_Vent_Cap',(x,D/2,z+h+.035),(w+.22,d+.20,.08),v.M_ROOF_SIDE,'Roofs',.02)
