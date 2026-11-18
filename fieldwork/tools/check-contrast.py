#!/usr/bin/env python3
"""WCAG AA check of tokens.css. Usage: python3 tools/check-contrast.py"""
import re, sys, pathlib
css = (pathlib.Path(__file__).parent.parent / "css/tokens.css").read_text()
def block(sel):
    m = re.search(re.escape(sel) + r"\s*\{(.*?)\n\}", css, re.S); return dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", m.group(1)))
light = block(':root, [data-theme="light"], .force-light')
dark = {**light, **block('[data-theme="dark"]')}
def lum(h):
    c = [int(h[i:i+2], 16)/255 for i in (1,3,5)]
    c = [x/12.92 if x <= .03928 else ((x+.055)/1.055)**2.4 for x in c]
    return .2126*c[0] + .7152*c[1] + .0722*c[2]
def cr(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la+.05)/(lb+.05)
PAIRS = [  # (fg, bg, min)
 ("text","bg",4.5),("text","surface",4.5),("text","surface-2",4.5),
 ("text-muted","bg",4.5),("text-muted","surface",4.5),("text-muted","surface-2",4.5),
 ("text-faint","surface",4.5),("text-faint","bg",4.5),("text-faint","surface-2",4.5),
 ("on-primary","primary",4.5),("on-primary","primary-hover",4.5),
 ("active-text","active-bg",4.5),("link","bg",4.5),("link","surface",4.5),
 ("positive","surface",4.5),("negative","surface",4.5),("positive","bg",4.5),("negative","bg",4.5),
 ("badge-ok-text","badge-ok-bg",4.5),("badge-warn-text","badge-warn-bg",4.5),
 ("badge-neg-text","badge-neg-bg",4.5),("badge-info-text","badge-info-bg",4.5),("badge-mute-text","badge-mute-bg",4.5),
 ("focus","bg",3),("focus","surface",3),("border-strong","surface",3),   # UI components (1.4.11)
 ("chart-1","surface",3),("chart-2","surface",3),("chart-3","surface",3),("chart-4","surface",3),("chart-5","surface",3),
 ("map-pin","surface-2",3),
]
bad = 0
for name, t in (("light", light), ("dark", dark)):
    print(f"\n== {name} ==")
    for fg, bg, mn in PAIRS:
        r = cr(t[fg], t[bg]); ok = r >= mn; bad += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {fg:>14} on {bg:<14} {r:5.2f}  (need {mn})")
print(f"\n{bad} failure(s)"); sys.exit(1 if bad else 0)
