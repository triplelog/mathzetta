# python3 tools/make-greek-font.py <newcomputermodern/otf> fonts      (needs: pip install fonttools brotli)
# Greek for Inline Math: the letters maths uses, cut from New Computer Modern's GUST-licensed fonts and renamed (the GUST Font License asks that derived fonts get new names)
import sys
from fontTools import subset
from fontTools.ttLib import TTFont
SRC, OUT = sys.argv[1], sys.argv[2]   # the otf/ folder of newcomputermodern.zip (CTAN fonts/newcomputermodern), and fonts/
UNICODES = list(range(0x391, 0x3A2)) + list(range(0x3A3, 0x3AA)) + list(range(0x3B1, 0x3CA)) + [0x3D1, 0x3D5, 0x3D6, 0x3F0, 0x3F1, 0x3F4, 0x3F5]
for src, style, sub in [('NewCM10-Book.otf', 'regular', 'Regular'), ('NewCM10-Italic.otf', 'italic', 'Italic')]:
    font = TTFont(f'{SRC}/{src}', recalcTimestamp=False)   # the source's dates: the same input makes the same files
    opts = subset.Options(); opts.layout_features = ['kern']; opts.flavor = 'woff2'; opts.name_IDs = [0, 13, 14]
    s = subset.Subsetter(opts); s.populate(unicodes=UNICODES); s.subset(font)
    name = font['name']
    full = f'Inline Math Greek {sub}'
    for nid, value in [(1, 'Inline Math Greek'), (2, sub), (3, f'InlineMathGreek-{sub};{src}'), (4, full), (6, f'InlineMathGreek-{sub}'),
                       (5, 'Version 1.0; Greek letters from New Computer Modern 8.1.1 (' + src + ')'),
                       (10, 'The Greek letters of New Computer Modern 8.1.1 (' + src + ', by Antonis Tsolomitis), cut for Inline Math and renamed. GUST Font License.')]:
        name.setName(value, nid, 3, 1, 0x409)
    font.flavor = 'woff2'
    font.save(f'{OUT}/inlinemath-greek-{style}.woff2')
    print(style, len(font.getBestCmap()), 'letters')
