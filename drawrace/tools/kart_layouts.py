# Folded kart-circuit generator — outer loop with the road turned back into the
# infield, the shape of a real kart track.
#
#   python3 tools/kart_layouts.py        # print every layout's lap and self-gap
#
# WHY THIS IS HERE AND NOT IN src/. The engine now supports these: `Track.project`
# and the line re-acquisition are locality-aware (hinted by where the car already
# was), which is what stops a car that misses a hairpin from snapping onto the
# neighbouring fold. Before that fix a flat-out lap posted 20 s on a 1086 m
# circuit by teleporting across the folds.
#
# What is NOT done is the balance. Folded circuits need a different AI
# configuration from ring circuits — the planner's margin costs it far more when
# most of the lap is corners — and the two do not share one setting. With the AI
# retuned for folds (skills up, path jitter down from 0.45 to 0.12 of half-width,
# which is what stopped the field's finishing order being chaotic) 21 of these 30
# passed `npm run tune`; the rest failed on greed not being punished enough, or
# on a realistic stroke finishing last. Both are tuning, not blockers.
#
# `min_self_gap` is the safety check that matters: two folds must stay further
# apart than the road is wide, or the circuit is ambiguous no matter how good
# the projection is.

import math, re


def arcpoly(verts, radius, per_arc=7, edge_every=30):
    """Rounded polyline -> dense centreline points. Concave corners welcome."""
    n=len(verts)
    rAt=(lambda i: radius[i%len(radius)]) if isinstance(radius,(list,tuple)) else (lambda i: radius)
    cs=[]
    for i,v in enumerate(verts):
        pv=verts[(i-1)%n]; q=verts[(i+1)%n]
        li=math.hypot(v[0]-pv[0],v[1]-pv[1]); lo=math.hypot(q[0]-v[0],q[1]-v[1])
        if li<1e-9 or lo<1e-9: raise ValueError("duplicate vertex %d"%i)
        ui=((v[0]-pv[0])/li,(v[1]-pv[1])/li); uo=((q[0]-v[0])/lo,(q[1]-v[1])/lo)
        turn=math.atan2(ui[0]*uo[1]-ui[1]*uo[0], ui[0]*uo[0]+ui[1]*uo[1])
        r=rAt(i)
        if abs(turn)<1e-6:
            cs.append(None); continue
        t=min(r*abs(math.tan(turn/2)), li*0.5, lo*0.5)
        r_eff=t/abs(math.tan(turn/2))
        a=(v[0]-ui[0]*t, v[1]-ui[1]*t); b=(v[0]+uo[0]*t, v[1]+uo[1]*t)
        sg=1 if turn>=0 else -1; c=(a[0]-ui[1]*sg*r_eff, a[1]+ui[0]*sg*r_eff)
        cs.append(dict(a=a,b=b,c=c,r=r_eff,turn=turn,frm=math.atan2(a[1]-c[1],a[0]-c[0])))
    out=[]
    for i in range(n):
        cur=cs[i]
        j=(i+1)%n
        while cs[j] is None: j=(j+1)%n
        nxt=cs[j]
        if cur is None: continue
        st=max(3,int(per_arc*abs(cur['turn'])/(math.pi/2)))
        for k in range(st+1):
            ang=cur['frm']+cur['turn']*(k/st)
            out.append((cur['c'][0]+math.cos(ang)*cur['r'], cur['c'][1]+math.sin(ang)*cur['r']))
        gap=math.hypot(nxt['a'][0]-cur['b'][0], nxt['a'][1]-cur['b'][1])
        m=max(1,int(gap/edge_every))
        for k in range(1,m+1):
            u=k/(m+1)
            out.append((cur['b'][0]+(nxt['a'][0]-cur['b'][0])*u, cur['b'][1]+(nxt['a'][1]-cur['b'][1])*u))
    return out

def length(pts):
    return sum(math.hypot(pts[(i+1)%len(pts)][0]-pts[i][0], pts[(i+1)%len(pts)][1]-pts[i][1]) for i in range(len(pts)))

def min_self_gap(pts, skip=14):
    """Closest approach between non-adjacent parts of the centreline."""
    n=len(pts); best=1e9
    for i in range(n):
        for j in range(i+skip, n-(skip if i==0 else 0)):
            d=math.hypot(pts[i][0]-pts[j][0], pts[i][1]-pts[j][1])
            if d<best: best=d
    return best

def report(name, pts):
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    print(f"{name:12s} {round(max(xs)-min(xs)):4d}x{round(max(ys)-min(ys)):4d}  lap {round(length(pts)):5d}  min self-gap {min_self_gap(pts):.0f} m")

def fmt(pts):
    return "    points: [\n"+"".join("      [%d, %d],\n"%(round(x),round(y)) for x,y in pts)+"    ],\n"

def set_circuit(path, cid, pts, width=None, laps=None, comment=None, classes=None):
    s=open(path).read()
    i=s.index('id: "%s"'%cid); j=s.index('\n  },', i)+1; blk=s[i:j]
    mm=re.search(r'    points: \[\n.*?\n    \],\n', blk, re.S)
    blk = blk[:mm.start()] + fmt(pts) + blk[mm.end():]
    if width is not None: blk=re.sub(r'width: \d+,','width: %d,'%width,blk,count=1)
    if laps is not None: blk=re.sub(r'laps: \d+,','laps: %d,'%laps,blk,count=1)
    if classes is not None:
        blk=re.sub(r'classes: \[[^\]]*\]','classes: [%s]'%", ".join('"%s"'%c for c in classes),blk,count=1)
    if comment is not None:
        blk=re.sub(r'(medals: \{[^}]*\},\n)(    //.*?\n)*',
                   lambda m: m.group(1)+"".join("    // %s\n"%l if l else "    //\n" for l in comment.split("\n")),
                   blk, count=1, flags=re.S)
    open(path,'w').write(s[:i]+blk+s[j:])
exec(open('.tmp/kart.py').read())

def mirror(V): return [(-x, y) for x, y in V][::-1]
def flip(V):   return [(x, -y) for x, y in V][::-1]

def one(w, h, a, b, inset=-28):
    """Outer loop with a single infield return between y=a and y=b."""
    return [(-w,-h),(w,-h),(w,a),(inset,a),(inset,b),(w,b),(w,h),(-w,h)]

def two(w, h, ys, inset=-30):
    V=[(-w,-h),(w,-h)]
    for k in range(0,len(ys),2): V += [(w,ys[k]),(inset,ys[k]),(inset,ys[k+1]),(w,ys[k+1])]
    V += [(w,h),(-w,h)]
    return V

def three(w, h, ys, inset=-32):
    return two(w, h, ys, inset)

def radii(V, outer, ret):
    """Big radii on the four outer corners, the given radius on every return."""
    return [outer if i < 2 or i >= len(V)-2 else ret for i in range(len(V))]

L = {}
def add(cid, V, outer, ret, w, laps, cls=None):
    L[cid] = (V, radii(V, outer, ret), w, laps, cls)

# ---- Rookie Cup: one infield return -----------------------------------------
add('harbour',    one(92,150,-40,26),      52, 34, 17, 1)
add('gravelpit',  one(90,146,-34,30),      50, 34, 18, 1)
add('riverside',  one(94,152,-16,48),      54, 35, 17, 1)
add('marina',     one(96,156,-30,34),       54, 44, 18, 1)
add('lakeside',   one(94,150,-28,38),      54, 35, 18, 1)
add('fairground', one(86,138,-30,26),      48, 34, 17, 1)
add('coast',      mirror(one(98,158,-26,38)), 54, 44, 18, 1, ['gt','rally'])
add('sandhills',  flip(one(90,144,-38,22)),   50, 34, 18, 1)
add('frostring',  one(100,162,-44,20),      66, 60, 21, 1)
add('snowfield',  one(96,156,-40,22),      64, 58, 21, 1)

# ---- National Series: two infield returns -----------------------------------
add('vantaa',     two(98,168,[-92,-34,28,88]),   56, 35, 19, 1)
add('dustbowl',   two(96,164,[-88,-32,26,84]),   54, 35, 20, 1)
add('nordic',     two(102,176,[-98,-38,32,94]),  58, 36, 21, 1)
add('ridgeway',   two(100,172,[-94,-36,30,90]),  56, 36, 20, 1)
add('timber',     two(94,160,[-86,-30,24,82]),   54, 35, 20, 1)
add('coppermine', mirror(two(96,162,[-88,-32,26,84])), 54, 35, 20, 1)
add('highlands',  flip(two(94,158,[-84,-30,24,80])),   54, 35, 19, 1)
add('autodrome',  two(98,186,[-108,-44,38,102]), 60, 38, 21, 1)
add('glacier',    two(100,176,[-98,-36,32,94]),   62, 52, 23, 1)
add('fjord',      one(100,174,-36,38),     70, 64, 23, 1)

# ---- World League: two returns, bigger and faster ---------------------------
add('oldtown',    two(102,196,[-120,-64,-30,26,60,116]), 58, 36, 20, 1)
add('quarry',     two(106,192,[-110,-44,38,104]), 58, 48, 24, 1)
add('cathedral',  two(110,208,[-130,-70,-34,30,66,126]), 64, 41, 23, 1)
add('blackrock',  mirror(two(104,188,[-106,-42,36,100])), 58, 48, 25, 1)
add('spire',      two(112,214,[-134,-72,-36,32,68,130]), 66, 43, 24, 1)
add('grand',      two(114,218,[-138,-74,-36,32,70,134]), 68, 44, 25, 1)
add('crucible',   two(100,188,[-110,-44,38,104], -34), 56, 46, 21, 1)
add('aurora',     two(106,186,[-104,-38,34,100]), 64, 54, 26, 1)
add('whiteout',   two(102,180,[-100,-36,32,96]),  62, 52, 25, 1)
add('midnight',   flip(one(106,190,-32,44)), 74, 68, 25, 1)
