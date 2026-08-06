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
# All thirty pass `npm run tune`, `npm run modes` and `npm run playtest`, at 18%
# more grip than the ring circuits could carry (GRIP_SCALE 1.82 -> 2.15). Folds
# are what bought that: on a ring, grip and greed-punishment are the same dial,
# so making the car stick makes a flat-out stroke viable. On a folded circuit the
# hairpins punish greed geometrically instead, and the tyres are free to grip.
#
# `min_self_gap` is the safety check that matters: two folds must stay further
# apart than the road is wide, or the circuit is ambiguous no matter how good
# the projection is. Run this file to see every layout's lap and worst gap; a
# layout that does not clear is listed at the end with the two points that clash.
#
# The other check lives in `npm run tune` ("the built circuit follows the
# authored layout"), because what this file emits is a polyline and what the game
# builds is a spline through it. A fold too narrow to survive the smoothing would
# vanish with nothing here complaining.

import math, re

# When set, min_self_gap returns (gap, i, j) so a fit failure can name the two
# places on the circuit that are too close instead of just the number.
_WHERE = False


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
    # Drop near-duplicate points. Where a corner's tangent length gets clamped by
    # a short edge, the arc's end and the next arc's start coincide, and the
    # straight-filling loop above still emits a point between them. Two samples
    # in the same place give the track a zero-length tangent and therefore a
    # garbage normal, which the renderer turns into a spike of kerb shooting
    # across the road. Visible as red streaks at the tip of every infield return.
    dedup=[out[0]]
    for p in out[1:]:
        if math.hypot(p[0]-dedup[-1][0], p[1]-dedup[-1][1]) > 0.75:
            dedup.append(p)
    while len(dedup) > 2 and math.hypot(dedup[0][0]-dedup[-1][0], dedup[0][1]-dedup[-1][1]) <= 0.75:
        dedup.pop()
    return dedup

def length(pts):
    return sum(math.hypot(pts[(i+1)%len(pts)][0]-pts[i][0], pts[(i+1)%len(pts)][1]-pts[i][1]) for i in range(len(pts)))

def min_self_gap(pts, apart=120.0):
    """Closest approach between two parts of the centreline that are far apart
    ALONG the track.

    Separation used to be counted in samples, which is wrong: `arcpoly` puts ~8
    samples in a corner and one every 30 m on a straight, so a fixed index skip
    means 300 m of straight but only 35 m of corner. Every circuit with tight
    outer corners reported a fold conflict against its own kerb, two points that
    are consecutive on the racing line. Aurora failed to fit for exactly this
    reason. Distance along the track is the quantity that was always meant.
    """
    n=len(pts)
    seg=[math.hypot(pts[(i+1)%n][0]-pts[i][0], pts[(i+1)%n][1]-pts[i][1]) for i in range(n)]
    s=[0.0]*n
    for i in range(1,n): s[i]=s[i-1]+seg[i-1]
    total=s[-1]+seg[-1]
    best=(1e9,0,0)
    for i in range(n):
        for j in range(i+1, n):
            ds=s[j]-s[i]
            if min(ds, total-ds) < apart: continue
            d=math.hypot(pts[i][0]-pts[j][0], pts[i][1]-pts[j][1])
            if d<best[0]: best=(d,i,j)
    return best[0] if not _WHERE else best

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

def mirror(V): return [(-x, y) for x, y in V][::-1]
def flip(V):   return [(x, -y) for x, y in V][::-1]
def swap(V):   return [(y, x) for x, y in V][::-1]

def circuit(W, H, right=(), left=(), top=(), bottom=()):
    """Compose a circuit from an outer loop with returns cut into any edge.

    The first version of this could only cut returns into the RIGHT edge of a
    portrait rectangle, so all thirty circuits came out as the same silhouette
    with the folds in slightly different places -- which is exactly what they
    looked like. Returns now enter from all four edges, swapping W/H gives
    landscape, and `warp` (below) bends the outer box off square.

    Each return is (from, to, depth) in the coordinate that runs ALONG its edge,
    ordered the way the lap travels that edge -- clockwise from the top-left, so
    top runs left-to-right, right runs top-to-bottom, bottom right-to-left and
    left bottom-to-top. `depth` is how far into the infield the U reaches.
    """
    V = [(-W, -H)]
    for a, b, d in top:    V += [(a, -H), (a, d), (b, d), (b, -H)]
    V += [(W, -H)]
    for a, b, d in right:  V += [(W, a), (d, a), (d, b), (W, b)]
    V += [(W, H)]
    for a, b, d in bottom: V += [(a, H), (a, d), (b, d), (b, H)]
    V += [(-W, H)]
    for a, b, d in left:   V += [(-W, a), (d, a), (d, b), (-W, b)]
    return V

# --- outer-shape warps -----------------------------------------------------
# Topology alone does not read as variety from the track-select screen: two
# circuits with different folds inside the same rectangle still share one
# silhouette. These bend the box itself. They are applied after the corner radii
# are chosen (which key off the untouched W/H), and they only move vertices, so
# the fold spacing the fitter checks is still measured on the real geometry.

def taper(t):
    """Trapezoid: the top edge narrows to (1-t) of the bottom."""
    return lambda V: [(x * (1 + t * y / max(abs(v[1]) for v in V)), y) for x, y in V]

def shear(t):
    """Parallelogram: each row slides sideways with height."""
    return lambda V: [(x + t * y, y) for x, y in V]

def rot(deg):
    """Turn the whole circuit on the diagonal."""
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return lambda V: [(x * c - y * s, x * s + y * c) for x, y in V]

def chain(*fs):
    def go(V):
        for f in fs: V = f(V)
        return V
    return go

def radii_for(V, W, H, outer, ret):
    """Big radius on the outer box corners, tighter on the infield returns."""
    return [outer if (abs(abs(x) - W) < 1e-6 and abs(abs(y) - H) < 1e-6) else ret
            for x, y in V]

L = {}
BAD = []

def add(cid, spec, W, H, outer, ret, w, laps, cls=None, warp=None, note=None):
    """Grow the circuit until its folds are comfortably further apart than the
    road is wide.

    Hand-picking coordinates that clear is a losing game -- a return that is fine
    at one size is ambiguous at another, and `min_self_gap` is the only check
    that actually matters. So the layout is authored in proportions and the
    builder scales it up until it passes, which also means a circuit can be
    given more returns without re-deriving every number by hand.
    """
    need = w + 12
    # Capped deliberately. Scaling always clears a gap eventually -- the gap
    # grows with the circuit while the road does not -- so an uncapped fitter
    # silently turns a badly-spaced layout into a 4 km one. Past 1.2x the
    # spacing is wrong at the source and should be fixed there.
    for step in range(5):
        k = 1 + step * 0.05
        V = spec(k)
        R = radii_for(V, W * k, H * k, outer, ret)
        if warp: V = warp(V)
        pts = arcpoly(V, R)
        if min_self_gap(pts) >= need:
            L[cid] = (V, R, w, laps, cls, note)
            return
    # Collect rather than abort. Thirty layouts get authored in one sitting and
    # dying on the first one hides the other twenty-nine, which turns a batch of
    # coordinate fixes into thirty round trips.
    global _WHERE
    _WHERE = True
    g, i, j = min_self_gap(pts)
    _WHERE = False
    BAD.append("%-11s gap %3.0f (need %d) between %s and %s"
               % (cid, g, need, tuple(round(c) for c in pts[i]), tuple(round(c) for c in pts[j])))
    L[cid] = (V, R, w, laps, cls, note)

# ============================================================================
# The thirty. Read down the `warp` column and the edge keywords: no two share a
# silhouette. That is the point of this table -- the previous version put every
# return into the right-hand flank of a portrait rectangle, and thirty circuits
# came out looking like one circuit drawn thirty times.
#
# The levers, roughly in order of how much they change what you see on the
# track-select screen:
#   1. the outer shape      -- rectangle / trapezoid / parallelogram / diagonal
#   2. aspect               -- portrait, landscape, square
#   3. which edges fold in  -- and whether opposite folds interlock like a comb
#   4. how deep the folds go -- a stub off one edge vs a spear across the infield
#   5. count                -- one fold reads as a lap with a kink; four reads as a maze

# =============================================================== Rookie Cup
# One fold, one idea each. Short enough to learn in a single stroke.
add('harbour',   lambda k: circuit(92*k,158*k, right=[(-66*k,64*k,-26*k)]),
    92,158, 54,46, 17,1)                                     # portrait, one wide right U
add('gravelpit', lambda k: circuit(96*k,150*k, left=[(60*k,-60*k,28*k)]),
    96,150, 54,46, 18,1, warp=taper(0.34))                   # trapezoid, folds from the left
add('frostring', lambda k: circuit(120*k,120*k, top=[(-40*k,40*k,60*k)]),
    120,120, 60,44, 20,1)                                    # square, one spear down the middle
add('riverside', lambda k: circuit(92*k,152*k, bottom=[(46*k,-46*k,32*k)]),
    92,152, 54,46, 17,1, warp=shear(0.30))                   # leaning parallelogram
add('marina',    lambda k: circuit(154*k,92*k, right=[(-44*k,44*k,54*k)]),
    154,92, 52,44, 19,1)                                     # landscape, deep right pocket
add('coast',     lambda k: circuit(150*k,90*k, top=[(-62*k,62*k,-16*k)]),
    150,90, 52,44, 20,1, ['gt','rally'], warp=rot(-18))      # a long diagonal sweep
add('sandhills', lambda k: circuit(88*k,150*k, right=[(-100*k,26*k,-20*k)]),
    88,150, 50,42, 18,1, warp=taper(0.52))                                     # portrait, fold pushed to the top
add('lakeside',  lambda k: circuit(94*k,146*k, left=[(100*k,-26*k,22*k)]),
    94,146, 52,58, 19,1, warp=taper(-0.30))                  # trapezoid the other way up
add('snowfield', lambda k: circuit(128*k,128*k, bottom=[(62*k,-62*k,-58*k)]),
    128,128, 60,44, 20,1)                                    # square, spear up from the bottom
add('fairground',lambda k: circuit(146*k,88*k, top=[(-96*k,-20*k,10*k)], bottom=[(96*k,20*k,-10*k)]),
    146,88, 50,42, 17,1)                                     # landscape S: two folds passing

# ========================================================== National Series
# Two or three folds. Now the shape of the infield matters as much as the outline.
add('vantaa',    lambda k: circuit(98*k,190*k, right=[(-140*k,-14*k,-24*k)], bottom=[(40*k,-40*k,150*k)]),
    98,190, 56,46, 19,1)                                     # right U over a bottom stub
add('dustbowl',  lambda k: circuit(150*k,150*k, top=[(-80*k,-24*k,44*k)], bottom=[(80*k,24*k,-44*k)]),
    150,150, 66,46, 20,1)                                    # square, two spears interlocking
add('nordic',    lambda k: circuit(102*k,208*k, right=[(-158*k,-28*k,-22*k),(28*k,158*k,-22*k)]),
    102,208, 58,48, 21,1)                                    # the classic double hairpin
add('ridgeway',  lambda k: circuit(106*k,204*k, right=[(-166*k,-36*k,-24*k)], left=[(166*k,36*k,24*k)]),
    106,204, 58,62, 24,1, warp=rot(-14))                                    # folds facing each other, offset
add('timber',    lambda k: circuit(190*k,96*k, top=[(-142*k,-12*k,-18*k)], bottom=[(142*k,12*k,18*k)]),
    190,96, 54,44, 20,1, warp=shear(-0.26))                  # sheared landscape comb
add('coppermine',lambda k: circuit(196*k,100*k, top=[(-150*k,-84*k,-14*k),(-16*k,50*k,-14*k)], bottom=[(150*k,84*k,14*k)]),
    196,100, 56,44, 20,1)                                    # three teeth along a wide box
add('autodrome', lambda k: circuit(96*k,196*k, top=[(-34*k,34*k,-104*k)], right=[(20*k,150*k,-20*k)]),
    96,196, 60,50, 21,1)                                     # long straight down one spear
add('glacier',   lambda k: circuit(186*k,102*k, right=[(-50*k,50*k,58*k)], top=[(-144*k,-74*k,-24*k)]),
    186,102, 64,56, 22,1, warp=taper(0.26))                  # wide trapezoid, deep right pocket
add('fjord',     lambda k: circuit(98*k,192*k, bottom=[(38*k,-38*k,104*k)], left=[(-20*k,-150*k,22*k)]),
    98,192, 60,52, 22,1, warp=taper(-0.28))                                     # mirror of autodrome's idea
add('highlands', lambda k: circuit(160*k,160*k, bottom=[(56*k,-56*k,40*k)], right=[(-120*k,-24*k,-30*k)]),
    160,160, 68,48, 19,1, warp=rot(22))                      # square turned on the diagonal

# ============================================================= World League
# Three and four folds, the largest boxes, the busiest silhouettes in the game.
add('oldtown',   lambda k: circuit(200*k,110*k, bottom=[(150*k,80*k,-40*k),(-30*k,-100*k,-40*k)]),
    200,110, 60,46, 20,1, warp=taper(0.22))                  # double hairpin in a wedge
add('quarry',    lambda k: circuit(112*k,240*k, right=[(-190*k,-120*k,-24*k),(-40*k,40*k,-24*k),(120*k,190*k,-24*k)]),
    112,240, 58,48, 21,1)                                    # triple hairpin, one flank
add('aurora',    lambda k: circuit(232*k,124*k, top=[(-160*k,-74*k,-16*k)], bottom=[(160*k,74*k,16*k),(36*k,-36*k,-20*k)]),
    232,124, 74,48, 26,1)                                    # the widest box in the game
add('whiteout',  lambda k: circuit(210*k,106*k, right=[(-54*k,54*k,56*k)], top=[(-162*k,-88*k,-24*k)]),
    210,106, 66,58, 24,1, warp=rot(-12))                      # tilted landscape, deep pocket
add('cathedral', lambda k: circuit(150*k,220*k, top=[(-110*k,-50*k,140*k)], bottom=[(110*k,50*k,-140*k)]),
    150,220, 64,48, 23,1, warp=rot(8))                       # two nave-length spears, interlocking
add('blackrock', lambda k: circuit(112*k,228*k, left=[(180*k,54*k,22*k),(-54*k,-180*k,22*k)], right=[(-16*k,16*k,-34*k)]),
    112,228, 58,48, 24,1, warp=shear(0.22))                   # cathedral's mirror, leaning
add('midnight',  lambda k: circuit(170*k,170*k, top=[(-24*k,24*k,90*k)], bottom=[(124*k,64*k,-96*k)], left=[(120*k,-120*k,-80*k)]),
    170,170, 70,50, 24,1)                                     # square, three spears from three sides
add('spire',     lambda k: circuit(124*k,250*k, right=[(-200*k,-70*k,0),(70*k,200*k,0)], bottom=[(-40*k,-88*k,-120*k)]),
    124,250, 64,54, 24,1, warp=shear(0.20))                                     # the tallest box in the game
add('crucible',  lambda k: circuit(120*k,232*k, right=[(-198*k,-128*k,-30*k),(12*k,82*k,-30*k)], left=[(196*k,146*k,30*k),(-24*k,-94*k,30*k)]),
    120,232, 60,44, 21,1)                                     # four folds, alternating flanks
add('grand',     lambda k: circuit(180*k,180*k, right=[(-140*k,-40*k,14*k),(40*k,140*k,14*k)], top=[(-120*k,-60*k,100*k)]),
    180,180, 74,52, 25,1, warp=rot(-30))                      # everything, on the diagonal

if __name__ == "__main__":
    for cid, (V, R, w, laps, cls, note) in L.items():
        report(cid, arcpoly(V, R))
    if BAD:
        print("\n%d layouts do not fit:" % len(BAD))
        for b in BAD: print("  " + b)

# In-game blurbs. Kept beside the layouts so a circuit's description and its
# shape cannot drift apart.
NOTES = {'harbour': 'A kart circuit at its simplest: an outer loop with the road folded back\ninto the infield once. That return is the only place on the lap the car turns\nthe other way, and the only place a greedy stroke has to admit it.', 'gravelpit': 'The paddock end is narrower than the pit end, so the circuit runs as a wedge.\nThe single return comes in from the left, which puts the slow corner on the\ninside of the long sweep rather than opposite it.', 'frostring': 'Square, and split down the middle by a spear of road that runs almost the full\nheight of the circuit before turning back. Two long straights for the price of\none very committed hairpin.', 'riverside': 'The whole circuit leans. Nothing here is square to anything else, which makes\nthe braking points hard to read off the shape and easy to read off the kerbs.', 'marina': 'Wide and shallow, with one deep pocket cut into the seaward flank. The lap is\nmostly full throttle; the pocket is where it is decided.', 'coast': 'A long diagonal sweep along the shoreline with a shallow scallop at the top.\nThe fastest lap barely uses the brakes -- which is exactly why the scallop\ncatches people out.', 'sandhills': 'The return sits high on the flank instead of centred, so the circuit is\nlopsided: a long open bottom half, then a sudden switchback before the line.', 'lakeside': "Gravelpit's wedge stood on its head, folding in from the left low down. The\nlap opens out as it goes, so the last corner is the fastest one.", 'snowfield': 'Square, with a spear driven up from the bottom edge nearly to the top. Two\nfull-length straights either side of one very slow turn.', 'fairground': 'Two shallow returns from opposite edges, passing each other in the middle.\nThe road crosses back on itself twice without ever touching.', 'vantaa': 'A tight return high on the right flank, then a long stub up from the bottom\nedge. The two halves of the lap ask for opposite things.', 'dustbowl': 'Two spears reaching past the centreline from opposite edges, offset so they\ninterlock instead of meeting. The infield is a single long corridor.', 'nordic': 'The classic double hairpin: two returns stacked down one flank with a short\nchute between them. Get the first one wrong and the second one is gone too.', 'ridgeway': 'Returns from both flanks, offset up the circuit so they never face each other.\nThe road weaves rather than folds.', 'timber': 'A sheared landscape box with long teeth from top and bottom. Everything is\nparallel and nothing is square.', 'coppermine': 'Three teeth along a wide box -- two down from the top, one up from the bottom.\nThe rhythm changes every corner and never repeats.', 'autodrome': 'The longest straight in the National Series runs down one side of a spear that\nreaches almost the full height of the circuit, then a hairpin off the flank.', 'glacier': 'A wide trapezoid with a deep pocket cut into the right flank and a shallow\nreturn off the top. The lap is fast, wide and unforgiving of a late brake.', 'fjord': "Autodrome's idea inverted: the spear climbs from the bottom edge and the flank\nreturn sits above it rather than below.", 'highlands': 'A square circuit turned onto the diagonal, with folds from the bottom and the\nright. Nothing on this lap lines up with the screen.', 'oldtown': 'A double hairpin inside a wedge, so the two returns are different widths even\nthough they are the same shape. The upper one is the one that bites.', 'quarry': 'Three hairpins stacked down one flank -- a full switchback. The corners\noutnumber the straights, which is what stops a flat-out stroke and gives a\nbetter driver somewhere to be better.', 'aurora': 'The widest circuit in the game, with long shallow returns from the top and\nbottom edges set at opposite ends. Enormous speeds, and a very long way round\nif you miss the entry.', 'whiteout': 'A tilted landscape box with a deep pocket in the flank and a return off the\ntop. The horizon is never where you expect it.', 'cathedral': 'Two spears the length of the nave, reaching past each other from opposite ends\nof the circuit. Four straights, four hairpins and nothing in between.', 'blackrock': "Two hairpins off the left flank with a spear from the right threading the gap\nbetween them, and the whole circuit leaning as it goes.", 'midnight': 'Three spears from three different edges of a square, none of them meeting. The\nbusiest infield in the game and the hardest lap to hold in your head.', 'spire': 'The tallest circuit in the game. Two hairpins down the right flank and a spear\nrunning nearly its full height up the left-hand channel.', 'crucible': 'Four folds alternating between the flanks, interleaved so the road weaves all\nthe way up the circuit. Almost no straight is longer than the one before it.', 'grand': 'Everything, on the diagonal: two deep hairpins off one flank and a long spear\ndown the other, inside a square turned thirty degrees. The championship\ndecider.'}
for _c, _n in NOTES.items():
    L[_c] = L[_c][:5] + (_n,)
