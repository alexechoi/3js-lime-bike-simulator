"""Top-down check of public/data/soho.json -> docs/preview.png"""
import json, os
from PIL import Image, ImageDraw
H = os.path.dirname(__file__)
d = json.load(open(os.path.join(H, "..", "public", "data", "soho.json")))
x0, z0, x1, z1 = d["scene"]
S = 2.2
im = Image.new("RGB", (int((x1 - x0) * S), int((z1 - z0) * S)), (52, 54, 58))
dr = ImageDraw.Draw(im)
P = lambda r: [((r[i] - x0) * S, (r[i + 1] - z0) * S) for i in range(0, len(r), 2)]
for poly in d["pavement"]:
    dr.polygon(P(poly[0]), fill=(176, 172, 164))
    for h in poly[1:]:
        dr.polygon(P(h), fill=(52, 54, 58))
for key, col in (("ped", (200, 186, 160)), ("green", (96, 150, 80))):
    for poly in d[key]:
        dr.polygon(P(poly[0]), fill=col)
for b in d["buildings"]:
    g = 90 + int(min(b["h"], 40) * 3)
    dr.polygon(P(b["p"]), fill=(g, g - 8, g - 20), outline=(60, 50, 40))
    p = P(b["p"]); n = len(p)
    for i, c in enumerate(b["f"]):
        if c == "1": dr.line([p[i], p[(i + 1) % n]], fill=(255, 240, 200), width=1)
for s in d["signs"]:
    dr.ellipse([((s["x"] - x0) * S - 2), ((s["z"] - z0) * S - 2), ((s["x"] - x0) * S + 2), ((s["z"] - z0) * S + 2)], fill=(0, 220, 80) if s["dest"] else (0, 120, 200))
for s in d["signals"]:
    px, pz = -s["tz"] * s["hw"], s["tx"] * s["hw"]
    dr.line([((s["x"] - px - x0) * S, (s["z"] - pz - z0) * S), ((s["x"] + px - x0) * S, (s["z"] + pz - z0) * S)], fill=(255, 60, 60) if s["ph"] == 0 else (255, 180, 0), width=3)
for s in d["zebras"]:
    px, pz = -s["tz"] * s["hw"], s["tx"] * s["hw"]
    dr.line([((s["x"] - px - x0) * S, (s["z"] - pz - z0) * S), ((s["x"] + px - x0) * S, (s["z"] + pz - z0) * S)], fill=(255, 255, 255), width=3)
for r in d["busRoutes"]:
    dr.line([((x - x0) * S, (z - z0) * S) for x, z in r["pts"]], fill=(220, 30, 30), width=2)
for e in d["graph"]["edges"]:
    dr.line([((x - x0) * S, (z - z0) * S) for x, z in e["p"]], fill=(60, 120, 255), width=1)
for l in d["lamps"]:
    dr.point(((l[0] - x0) * S, (l[1] - z0) * S), fill=(255, 255, 0))
for p in d["plates"]:
    dr.rectangle([((p["x"] - x0) * S - 1), ((p["z"] - z0) * S - 1), ((p["x"] - x0) * S + 1), ((p["z"] - z0) * S + 1)], fill=(255, 0, 255))
px0, pz0, px1, pz1 = d["play"]
dr.rectangle([(px0 - x0) * S, (pz0 - z0) * S, (px1 - x0) * S, (pz1 - z0) * S], outline=(0, 255, 0), width=2)
os.makedirs(os.path.join(H, "..", "docs"), exist_ok=True)
im.save(os.path.join(H, "..", "docs", "preview.png"))
print(im.size)
