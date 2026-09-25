import os
from glyph import text_path
Y="#FACC15";K="#0A0A0A";W="#FFFFFF"
B='inter-latin-800-normal.woff'; M='inter-latin-600-normal.woff'
OUT='out'; os.makedirs(OUT,exist_ok=True)
def f(v): return f"{v:.2f}".rstrip('0').rstrip('.')
# --- S glyph normalised: path in units where S height = 1 ---
dS,wS,bS=text_path(B,'S',100)
S_H=bS[3]-bS[1]; S_W=bS[2]-bS[0]
def S_at(cx,cy,h,fill):
    s=h/S_H; x=cx-(S_W*s)/2-bS[0]*s; y=cy+h/2-bS[3]*s
    d,_,_=text_path(B,'S',100*s,x=x,y=y)
    return f'<path d="{d}" fill="{fill}"/>'
SR=0.58   # S height / symbol side
RR=0.22   # corner radius / side
def symbol(x,y,size,bg=Y,ink=K):
    return (f'<rect x="{f(x)}" y="{f(y)}" width="{f(size)}" height="{f(size)}" rx="{f(size*RR)}" fill="{bg}"/>'
            + S_at(x+size/2,y+size/2,size*SR,ink))
def symbol_knock(x,y,size,ink):
    # one-ink version: S cut out of the square (mask), transparent S
    mid=f"k{int(x)}{int(y)}{int(size)}"
    return (f'<mask id="{mid}"><rect x="{f(x)}" y="{f(y)}" width="{f(size)}" height="{f(size)}" rx="{f(size*RR)}" fill="#fff"/>'
            + S_at(x+size/2,y+size/2,size*SR,'#000') + '</mask>'
            + f'<rect x="{f(x)}" y="{f(y)}" width="{f(size)}" height="{f(size)}" rx="{f(size*RR)}" fill="{ink}" mask="url(#{mid})"/>')
def word(x,base,cap,fill,text='SCOLA',font=B,track=0.08):
    size=cap/0.727
    d,w,b=text_path(font,text,size,x=x,y=base,tracking=track)
    return f'<path d="{d}" fill="{fill}"/>', b
def svg(w,h,body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" width="{f(w)}" height="{f(h)}">{body}</svg>'
def measure(text,font,cap,track):
    size=cap/0.727; d,w,b=text_path(font,text,size,tracking=track); return b[2]-b[0], b[0]
# ---------- horizontal ----------
def horizontal(sub=True,mode='pos'):
    H=100; gap=26
    cap=40 if sub else 44
    ww,off=measure('SCOLA',B,cap,0.08)
    subcap=10.4
    sw_,soff=measure('GESTÃO ESCOLAR',M,subcap,0.0)
    # letterspace the subline so it matches the wordmark width
    n=len('GESTÃO ESCOLAR')-1; size=subcap/0.727
    trk=(ww-sw_)/n/size
    x0=H+gap-off
    if sub:
        block=cap+11+subcap; top=(H-block)/2; base1=top+cap; base2=base1+11+subcap
    else: base1=(H+cap)/2
    if mode=='pos': ink_t=K; sym=symbol(0,0,H); sub_c='#616161'
    elif mode=='neg': ink_t=W; sym=symbol(0,0,H); sub_c='#A3A3A3'
    elif mode=='mono-k': ink_t=K; sym=symbol_knock(0,0,H,K); sub_c=K
    else: ink_t=W; sym=symbol_knock(0,0,H,W); sub_c=W
    p1,b1=word(x0,base1,cap,ink_t)
    body=sym+p1
    if sub:
        p2,b2=word(H+gap-soff,base2,subcap,sub_c,'GESTÃO ESCOLAR',M,trk); body+=p2
    width=H+gap+ww
    return svg(width,H,body)
def vertical(mode='pos'):
    Hs=100; cap=34; gap=22; subcap=8.8
    ww,off=measure('SCOLA',B,cap,0.08); sw_,soff=measure('GESTÃO ESCOLAR',M,subcap,0.0)
    n=13; trk=(ww-sw_)/n/(subcap/0.727)
    Wd=max(ww,Hs); cx=Wd/2
    if mode=='pos': sym=symbol(cx-Hs/2,0,Hs); t=K; sc='#616161'
    else: sym=symbol(cx-Hs/2,0,Hs); t=W; sc='#A3A3A3'
    base1=Hs+gap+cap; base2=base1+10+subcap
    p1,_=word(cx-ww/2-off,base1,cap,t); p2,_=word(cx-ww/2-soff,base2,subcap,sc,'GESTÃO ESCOLAR',M,trk)
    return svg(Wd,base2+2,sym+p1+p2)
files={
 'scola-horizontal.svg':horizontal(True,'pos'),
 'scola-horizontal-negativa.svg':horizontal(True,'neg'),
 'scola-horizontal-compacta.svg':horizontal(False,'pos'),
 'scola-horizontal-compacta-negativa.svg':horizontal(False,'neg'),
 'scola-vertical.svg':vertical('pos'),
 'scola-vertical-negativa.svg':vertical('neg'),
 'scola-simbolo.svg':svg(100,100,symbol(0,0,100)),
 'scola-mono-preta.svg':horizontal(True,'mono-k'),
 'scola-mono-branca.svg':horizontal(True,'mono-w'),
 'scola-simbolo-mono-preto.svg':svg(100,100,symbol_knock(0,0,100,K)),
 'scola-simbolo-mono-branco.svg':svg(100,100,symbol_knock(0,0,100,W)),
}
for k,v in files.items(): open(os.path.join(OUT,k),'w').write(v)
# ---- icons ----
os.makedirs('icons',exist_ok=True)
open('icons/favicon.svg','w').write(svg(100,100,symbol(0,0,100)).replace('viewBox="0 0 100 100" width="100" height="100"','viewBox="0 0 100 100"',1))
def full(size,sfrac):  # solid yellow full-bleed square, S at sfrac of side
    return svg(size,size,f'<rect width="{size}" height="{size}" fill="{Y}"/>'+S_at(size/2,size/2,size*sfrac,K))
open('icons/icon-512.svg','w').write(full(512,0.42))   # S 215px tall: well inside the 410px safe circle
open('icons/icon-192.svg','w').write(full(192,0.46))
open('icons/apple-touch-icon.svg','w').write(full(180,0.46))
open('icons/favicon-16.svg','w').write(svg(16,16,'<rect width="16" height="16" rx="3" fill="#FACC15"/>'+S_at(8,8,10.5,K)))
print('ok')
