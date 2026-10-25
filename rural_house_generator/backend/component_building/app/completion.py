"""Conservative side/rear design openings, explicitly unrelated to detections."""
def hidden_openings(masses,depth,floors,floor_height,enabled=True):
    if not enabled:return {'enabled':False,'source':'rule-completion','openings':[]}
    out=[]
    door_mass=max(masses,key=lambda m:m['x1']-m['x0'])
    door_center=(door_mass['x0']+door_mass['x1'])/2
    def add(face,mass,x,width,bottom,height,kind='window'):
        out.append({'id':f'completion-{len(out)}','face':face,'mass':mass['id'],
            'x':x,'width':width,'bottom':bottom,'height':height,'kind':kind,
            'shape':'rect','arch_rise':0,'source':'rule-completion'})
    door_width=min(1.05,(door_mass['x1']-door_mass['x0'])*.5)
    add('rear',door_mass,door_center,door_width,.08,min(2.2,floor_height-.25),'door')
    for m in masses:
        span=m['x1']-m['x0'];columns=max(1,min(3,int(span/2.8)))
        for floor in range(floors):
            for col in range(columns):
                x=m['x0']+span*(col+.5)/columns;width=min(1.2,span/columns*.48)
                if floor==0 and m['id']==door_mass['id'] and abs(x-door_center)<(width+door_width)/2+.2:continue
                add('rear',m,x,width,floor*floor_height+.8,min(1.55,floor_height-1.05))
    for face,m in [('left',masses[0]),('right',masses[-1])]:
        span=depth-m['front'];columns=max(1,min(3,int(span/3.2)))
        for floor in range(floors):
            for col in range(columns):
                add(face,m,m['front']+span*(col+.5)/columns,min(1.15,span/columns*.45),
                    floor*floor_height+.8,min(1.55,floor_height-1.05))
    return {'enabled':True,'source':'rule-completion','openings':out}
