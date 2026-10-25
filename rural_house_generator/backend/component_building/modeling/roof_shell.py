"""Closed outward roof cores, independent of bpy and decorative tile meshes."""
from collections import defaultdict

EAVE_ABOVE_WALL=.16
SOFFIT_THICKNESS=.18


def build_roof_shell(kind,m,depth,height,roof,wall_thickness=.23):
    overhang=max(roof.get('overhang',.38),wall_thickness/2+.02)
    x0,x1=m['x0']-overhang,m['x1']+overhang
    y0,y1=m['front']-overhang,depth+overhang
    eave=height+EAVE_ABOVE_WALL;bottom=eave-SOFFIT_THICKNESS;rise=roof['rise']
    if kind=='hip':
        cx,cy=(x0+x1)/2,(y0+y1)/2;rl=(x1-x0)*.27
        vertices=[(x0,y0,eave),(x1,y0,eave),(x1,y1,eave),(x0,y1,eave),
                  (cx-rl,cy,eave+rise),(cx+rl,cy,eave+rise),
                  (x0,y0,bottom),(x1,y0,bottom),(x1,y1,bottom),(x0,y1,bottom)]
        faces=[(0,1,5,4),(3,4,5,2),(0,4,3),(1,2,5),
               (9,8,7,6),(6,7,1,0),(7,8,2,1),(8,9,3,2),(9,6,0,3)]
        materials=['tile0','tile1','tile2','tile0','underside']+['underside']*4
    elif kind=='gable':
        n=16;curve=roof.get('eave_curve',0);vertices=[];faces=[];materials=[]
        for layer in [0,1]:
            for j in range(n+1):
                y=y0+(y1-y0)*j/n;slope=1-abs(2*j/n-1)
                for i in range(n+1):
                    x=x0+(x1-x0)*i/n;edge=abs(2*i/n-1)
                    z=eave+rise*slope+curve*edge**8*(1-slope)**3 if layer==0 else bottom
                    vertices.append((x,y,z))
        count=(n+1)**2
        for j in range(n):
            for i in range(n):
                a=j*(n+1)+i;quad=(a,a+1,a+n+2,a+n+1)
                faces.extend([quad,tuple(k+count for k in reversed(quad))]);materials.extend(['tile0','underside'])
        perimeter=list(range(n+1))+[j*(n+1)+n for j in range(1,n+1)]+[n*(n+1)+i for i in range(n-1,-1,-1)]+[j*(n+1) for j in range(n-1,0,-1)]
        for a,b in zip(perimeter,perimeter[1:]+perimeter[:1]):
            faces.append((a+count,b+count,b,a));materials.append('underside')
    else:raise ValueError('Unsupported pitched roof kind')
    return {'vertices':vertices,'faces':faces,'materials':materials,'bottom_z':bottom,
            'eave_z':eave,'overhang_effective':overhang}


def audit_shell(shell):
    edges=defaultdict(list);volume=0.;v=shell['vertices']
    for face in shell['faces']:
        for a,b in zip(face,face[1:]+face[:1]):edges[tuple(sorted((a,b)))].append((a,b))
        a=v[face[0]]
        for i in range(1,len(face)-1):
            b,c=v[face[i]],v[face[i+1]]
            volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
    return {'boundary_edges':sum(len(rows)==1 for rows in edges.values()),
            'nonmanifold_edges':sum(len(rows)!=2 for rows in edges.values()),
            'winding_conflicts':sum(len(rows)==2 and rows[0]==rows[1] for rows in edges.values()),
            'signed_volume':volume}
