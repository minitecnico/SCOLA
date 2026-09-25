from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
def text_path(fontfile, text, size, x=0, y=0, tracking=0.0):
    """returns (d, width, bounds) ; y = baseline"""
    f=TTFont(fontfile); gs=f.getGlyphSet(); cmap=f.getBestCmap(); upm=f['head'].unitsPerEm
    s=size/upm; pen=SVGPathPen(gs,ntos=lambda v:(f'{v:.2f}').rstrip('0').rstrip('.')); cx=0; bp=BoundsPen(gs)
    names=[cmap[ord(c)] for c in text]
    for i,n in enumerate(names):
        g=gs[n]
        tp=TransformPen(pen,(s,0,0,-s,x+cx,y)); g.draw(tp)
        tb=TransformPen(bp,(s,0,0,-s,x+cx,y)); g.draw(tb)
        cx+=g.width*s + (tracking*size if i<len(names)-1 else 0)
    return pen.getCommands(), cx, bp.bounds
