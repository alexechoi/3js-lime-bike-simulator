"""Turn the raw OSM extract into the compact scene the game loads.

    python pipeline/fetch_osm.py     # once (or use the committed .json.gz)
    python pipeline/build_map.py     # -> public/data/soho.json

Coordinates: metres, origin at Oxford Circus, +x east, +z SOUTH (so the
three.js scene is x/z with y up and north is -z).
"""
import gzip
import hashlib
import json
import math
import os
import re
from collections import defaultdict

from shapely import STRtree, set_precision
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "..", "data", "raw", "soho-osm.json")
OUT = os.path.join(HERE, "..", "public", "data", "soho.json")

LAT0, LON0 = 51.51521, -0.14190  # Oxford Circus
MX = 111320.0 * math.cos(math.radians(LAT0))
MZ = 111250.0

PLAY = (-150.0, -150.0, 650.0, 425.0)  # minx, minz, maxx, maxz: Lime service zone
SCENE = (-400.0, -390.0, 900.0, 660.0)  # everything that gets drawn

DRIVE = {
    "primary", "primary_link", "secondary", "secondary_link", "tertiary",
    "tertiary_link", "unclassified", "residential", "living_street", "service",
}
MAIN = {"Oxford Street", "Regent Street"}


def proj(lon, lat):
    return ((lon - LON0) * MX, (LAT0 - lat) * MZ)


def h01(*parts):
    s = "|".join(str(p) for p in parts).encode()
    return int(hashlib.md5(s).hexdigest()[:8], 16) / 0xFFFFFFFF


def r2(v):
    return round(v, 2)


def ring_coords(ring):
    c = list(ring.coords)[:-1]
    out = []
    for x, z in c:
        out.append(r2(x))
        out.append(r2(z))
    return out


def poly_out(geom):
    """MultiPolygon/Polygon -> [[outer, hole, ...], ...] of flat coord lists."""
    polys = []
    if geom.is_empty:
        return polys
    gs = geom.geoms if hasattr(geom, "geoms") else [geom]
    for g in gs:
        if g.geom_type != "Polygon" or g.area < 0.5:
            continue
        g = orient(g, 1.0)
        polys.append([ring_coords(g.exterior)] + [ring_coords(i) for i in g.interiors if Polygon(i).area > 0.3])
    return polys


def parse_len(v):
    if v is None:
        return None
    m = re.match(r"\s*([0-9.]+)", str(v))
    return float(m.group(1)) if m else None


def main():
    path = RAW if os.path.exists(RAW) else RAW + ".gz"
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt") as f:
        raw = json.load(f)
    els = raw["elements"]
    nodes = {e["id"]: e for e in els if e["type"] == "node"}
    ways = {e["id"]: e for e in els if e["type"] == "way"}
    rels = [e for e in els if e["type"] == "relation"]
    pos = {i: proj(n["lon"], n["lat"]) for i, n in nodes.items()}
    scene_box = box(*SCENE)
    play_box = box(*PLAY)

    def way_pts(w):
        return [pos[n] for n in w["nodes"] if n in pos]

    # ------------------------------------------------------------------ roads
    roads = []
    zone_lines = []  # Oxford Street, traffic-free since 26 October 2026
    for w in ways.values():
        t = w.get("tags", {})
        hw = t.get("highway")
        if not hw:
            continue
        if t.get("tunnel") in ("yes", "building_passage") and hw not in DRIVE:
            pass
        if t.get("layer", "0").lstrip("-").isdigit() and int(t.get("layer", "0")) < 0:
            continue
        if t.get("indoor") == "yes" or t.get("area") == "yes":
            continue
        name = t.get("name", "")
        pts = way_pts(w)
        if len(pts) < 2:
            continue
        kind = None
        oneway = t.get("oneway") == "yes"
        if hw in DRIVE:
            if hw == "service" and (t.get("access") in ("private", "no") or t.get("service") in ("parking_aisle", "driveway")):
                continue
            kind = hw.replace("_link", "")
        elif hw == "pedestrian":
            # Oxford Street is mid-pedestrianisation in the 2026 data; the game
            # keeps the buses, so treat it as the main road it was.
            kind = "primary" if name == "Oxford Street" else "pedestrian"
            if name == "Oxford Street":
                oneway = False
                zone_lines.append(LineString(pts))
        elif hw in ("footway", "path", "cycleway"):
            if t.get("footway") in ("sidewalk", "crossing") or t.get("tunnel") == "yes":
                continue
            kind = "footway"
        else:
            continue
        lanes = parse_len(t.get("lanes"))
        if kind == "primary":
            width = 6.6 if oneway else 11.0
            if name == "Regent Street" and not oneway:
                width = 12.5
        elif kind == "secondary":
            width = 6.2 if oneway else 9.0
        elif kind == "tertiary":
            width = 5.2 if oneway else 7.4
        elif kind in ("unclassified", "residential", "living_street"):
            width = 4.4 if oneway else 6.0
        elif kind == "service":
            width = 3.6
        elif kind == "pedestrian":
            width = parse_len(t.get("width")) or 6.5
        else:
            width = 2.8
        if lanes and kind not in ("pedestrian", "footway", "primary"):
            width = max(width, lanes * 3.0 + 0.6)
        roads.append({"id": w["id"], "name": name, "kind": kind, "oneway": oneway, "width": width,
                      "pts": pts, "nodes": [n for n in w["nodes"] if n in pos], "bus": name in MAIN})

    footnames = {r["name"] for r in roads if r["kind"] not in ("footway", "pedestrian") and r["name"]}
    roads = [r for r in roads if not (r["kind"] == "footway" and r["name"] in footnames)]
    drive_roads = [r for r in roads if r["kind"] not in ("footway", "pedestrian")]

    # -------------------------------------------------------------- buildings
    def levels_height(t, key):
        lv = parse_len(t.get("building:levels"))
        h = parse_len(t.get("height"))
        if h and h > 2:
            return h, lv
        if lv and lv >= 1:
            rl = parse_len(t.get("roof:levels")) or 0
            return 4.4 + (lv - 1 + rl) * 3.35 + 1.0, lv
        return None, lv

    raw_b = []  # (polygon, tags, id, is_part)
    for w in ways.values():
        t = w.get("tags", {})
        if "building" not in t and "building:part" not in t:
            continue
        if t.get("building") in ("no", "roof") or t.get("location") == "underground":
            continue
        pts = way_pts(w)
        if len(pts) < 4 or w["nodes"][0] != w["nodes"][-1]:
            continue
        try:
            p = Polygon(pts)
            if not p.is_valid:
                p = p.buffer(0)
            if p.geom_type == "MultiPolygon":
                p = max(p.geoms, key=lambda g: g.area)
        except Exception:  # noqa: BLE001
            continue
        if p.is_empty or p.area < 6:
            continue
        raw_b.append((p, t, w["id"], "building" not in t))
    for r in rels:
        t = r.get("tags", {})
        if "building" not in t or t.get("type") != "multipolygon":
            continue
        outers = []
        for m in r.get("members", []):
            if m["type"] == "way" and m.get("role") in ("outer", "") and m["ref"] in ways:
                pts = way_pts(ways[m["ref"]])
                if len(pts) >= 4 and pts[0] == pts[-1]:
                    outers.append(Polygon(pts).buffer(0))
        for i, p in enumerate(outers):
            if p.geom_type == "Polygon" and p.area > 6:
                raw_b.append((p, t, r["id"] * 10 + i, False))

    parts = [b for b in raw_b if b[3]]
    part_tree = STRtree([b[0] for b in parts]) if parts else None
    buildings = []
    for p, t, bid, is_part in raw_b:
        c = p.centroid
        if not scene_box.contains(c):
            continue
        if not is_part and part_tree is not None:
            cover = 0.0
            for i in part_tree.query(p):
                cover += parts[i][0].intersection(p).area
            if cover > 0.6 * p.area:
                continue  # drawn by its parts instead
            if cover > 1.0:
                rest = p.difference(unary_union([parts[i][0] for i in part_tree.query(p)]).buffer(0.05))
                rest = rest.buffer(-0.3).buffer(0.3)
                pieces = [g for g in (rest.geoms if hasattr(rest, "geoms") else [rest]) if g.geom_type == "Polygon" and g.area > 12]
                if not pieces:
                    continue
                p = max(pieces, key=lambda g: g.area)
        h, lv = levels_height(t, bid)
        mh = parse_len(t.get("min_height")) or ((parse_len(t.get("building:min_level")) or 0) * 3.4)
        buildings.append({"poly": p, "t": t, "id": bid, "h": h, "lv": lv, "mh": mh, "part": is_part})

    main_lines = {n: unary_union([LineString(r["pts"]) for r in roads if r["name"] == n]) for n in MAIN}
    for b in buildings:
        c = b["poly"].centroid
        b["dmain"] = min(main_lines[n].distance(c) for n in MAIN)
        b["dregent"] = main_lines["Regent Street"].distance(c)
        if b["h"] is None:
            base = 6 if b["dmain"] < 45 else 4
            lv = base + int(h01(b["id"], "lv") * 2.4)
            b["h"] = 4.4 + (lv - 1) * 3.35 + 1.0
            b["lv"] = lv
        b["h"] = min(b["h"], 60.0)

    # simplify footprints, drop tiny ones
    for b in buildings:
        p = b["poly"].simplify(0.25)
        if p.geom_type != "Polygon" or p.is_empty:
            p = b["poly"]
        b["poly"] = orient(Polygon(p.exterior), 1.0)
    buildings = [b for b in buildings if b["poly"].area > 8 and b["h"] - b["mh"] > 1.5]
    b_polys = [b["poly"] for b in buildings]
    b_tree = STRtree(b_polys)
    all_b = unary_union(b_polys)
    print("buildings", len(buildings))

    # ---------------------------------------------------------- ground polygons
    carriage_raw = unary_union([LineString(r["pts"]).buffer(r["width"] / 2, cap_style="round", join_style="round")
                                for r in drive_roads])
    # wide pavements: keep 4 m clear in front of every building where the street
    # allows it, but never squeeze a lane below ~3.4 m
    min_lane = unary_union([LineString(r["pts"]).buffer(1.7, cap_style="round") for r in drive_roads])
    carriage_raw = unary_union([
        carriage_raw.difference(all_b.buffer(4.0, join_style="mitre")),
        min_lane.difference(all_b.buffer(1.5, join_style="mitre")),
    ])
    carriage_raw = carriage_raw.buffer(-0.7).buffer(0.7)
    pavement = scene_box.difference(carriage_raw)
    pavement = pavement.buffer(-1.6, join_style="round").buffer(1.6, join_style="round")  # round the kerb corners
    pavement = pavement.buffer(1.0, join_style="round").buffer(-1.0, join_style="round")  # close slivers of road
    pavement = set_precision(pavement.simplify(0.12), 0.01)
    carriage = scene_box.difference(pavement)
    carriage = carriage.buffer(0)

    ped_geoms = [LineString(r["pts"]).buffer(r["width"] / 2, cap_style="round") for r in roads if r["kind"] == "pedestrian"]
    for w in ways.values():
        t = w.get("tags", {})
        if t.get("highway") == "pedestrian" and t.get("area") == "yes":
            pts = way_pts(w)
            if len(pts) >= 4:
                ped_geoms.append(Polygon(pts).buffer(0))
    ped = unary_union(ped_geoms).difference(all_b.buffer(0.3)).intersection(pavement).intersection(scene_box)
    ped = ped.buffer(-0.4).buffer(0.4).simplify(0.15)

    green_geoms = []
    for w in ways.values():
        t = w.get("tags", {})
        if t.get("leisure") in ("park", "garden") or t.get("landuse") in ("grass", "village_green"):
            pts = way_pts(w)
            if len(pts) >= 4 and pts[0] == pts[-1]:
                green_geoms.append(Polygon(pts).buffer(0))
    green = unary_union(green_geoms).intersection(scene_box).difference(all_b).intersection(pavement).simplify(0.2) if green_geoms else Polygon()

    def in_carriage(x, z):
        return carriage.contains(Point(x, z))

    # --------------------------------------------------------- building export
    open_space = all_b  # anything not inside a building footprint is open
    out_b = []
    edge_info = []  # per building: list of (ax,az,bx,bz,len,facing)
    for bi, b in enumerate(buildings):
        ring = list(b["poly"].exterior.coords)[:-1]
        n = len(ring)
        flags = ""
        edges = []
        for i in range(n):
            ax, az = ring[i]
            bx, bz = ring[(i + 1) % n]
            dx, dz = bx - ax, bz - az
            L = math.hypot(dx, dz)
            if L < 0.05:
                flags += "0"
                edges.append((ax, az, bx, bz, L, False))
                continue
            nx, nz = dz / L, -dx / L  # outward for a CCW ring
            hits = 0
            samples = (0.5,) if L < 4 else (0.2, 0.5, 0.8)
            for s in samples:
                px, pz = ax + dx * s + nx * 1.3, az + dz * s + nz * 1.3
                pt = Point(px, pz)
                blocked = False
                for j in b_tree.query(pt):
                    if j != bi and b_polys[j].contains(pt) and buildings[j]["h"] > b["mh"] + 3 and buildings[j]["mh"] < 3:
                        blocked = True
                        break
                if not blocked:
                    hits += 1
            facing = hits * 2 > len(samples)
            flags += "1" if facing else "0"
            edges.append((ax, az, bx, bz, L, facing))
        edge_info.append(edges)
        t = b["t"]
        c = b["poly"].centroid
        out_b.append({
            "p": ring_coords(b["poly"].exterior),
            "h": r2(b["h"]),
            "mh": r2(b["mh"]),
            "lv": int(b["lv"] or 0),
            "f": flags,
            "mat": t.get("building:material", ""),
            "col": t.get("building:colour", ""),
            "use": t.get("building", "yes") if not b["part"] else "part",
            "name": t.get("name", ""),
            "arch": t.get("building:architecture", ""),
            "dm": r2(min(b["dmain"], 999)),
            "dr": r2(min(b["dregent"], 999)),
            "play": bool(play_box.buffer(90).contains(c)),
            "s": r2(h01(b["id"], "seed")),
        })

    # -------------------------------------------------------------- shop signs
    POI_AMENITY = {"restaurant", "cafe", "pub", "bar", "fast_food", "bank", "pharmacy", "cinema", "theatre",
                   "nightclub", "ice_cream", "bureau_de_change", "post_office", "casino"}
    POI_TOURISM = {"hotel", "museum", "gallery", "attraction"}
    sign_zone = play_box.buffer(150)
    pois = []

    def poi_kind(t):
        if "shop" in t:
            return "shop:" + t["shop"]
        if t.get("amenity") in POI_AMENITY:
            return t["amenity"]
        if t.get("tourism") in POI_TOURISM:
            return t["tourism"]
        return None

    for n in nodes.values():
        t = n.get("tags", {})
        k = poi_kind(t)
        if k and t.get("name") and t.get("level", "0") in ("0", "0;1", "0-1", "0;-1"):
            x, z = pos[n["id"]]
            if sign_zone.contains(Point(x, z)):
                pois.append({"name": t["name"], "kind": k, "x": x, "z": z, "own": None, "brand": t.get("brand", "")})
    for bi, b in enumerate(buildings):
        t = b["t"]
        k = poi_kind(t)
        if k and t.get("name") and not b["part"]:
            c = b["poly"].representative_point()
            if sign_zone.contains(c):
                pois.append({"name": t["name"], "kind": k, "x": c.x, "z": c.y, "own": bi, "brand": t.get("brand", "")})
    # one sign per (name, ~place)
    seen = set()
    uniq = []
    for p in pois:
        key = (p["name"].lower(), round(p["x"] / 25), round(p["z"] / 25))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(p)
    pois = uniq

    per_edge = defaultdict(list)
    for p in pois:
        pt = Point(p["x"], p["z"])
        cands = [p["own"]] if p["own"] is not None else [j for j in b_tree.query(pt.buffer(14)) if buildings[j]["mh"] < 1]
        best = None
        for j in cands:
            for ei, (ax, az, bx, bz, L, facing) in enumerate(edge_info[j]):
                if not facing or L < 2.6:
                    continue
                dx, dz = bx - ax, bz - az
                tt = max(0.0, min(1.0, ((p["x"] - ax) * dx + (p["z"] - az) * dz) / (L * L)))
                d = math.hypot(p["x"] - (ax + dx * tt), p["z"] - (az + dz * tt))
                if p["own"] is not None:
                    # the building is the shop: prefer its long, road-facing fronts
                    mx, mz = (ax + bx) / 2 + dz / L * 6, (az + bz) / 2 - dx / L * 6
                    d = -L + (0 if carriage.distance(Point(mx, mz)) < 6 or ped.distance(Point(mx, mz)) < 4 else 30)
                    tt = 0.5
                if best is None or d < best[0]:
                    best = (d, j, ei, tt)
        if best is None or (p["own"] is None and best[0] > 14):
            continue
        per_edge[(best[1], best[2])].append((best[3], p))

    signs = []
    for (j, ei), lst in per_edge.items():
        ax, az, bx, bz, L, _ = edge_info[j][ei]
        dx, dz = (bx - ax) / L, (bz - az) / L
        lst.sort(key=lambda q: q[0])
        want = [min(7.0, max(2.4, len(p["name"]) * 0.36 + 1.2)) for _, p in lst]
        gap = 0.35
        avail = L - 0.5
        while lst and sum(want) + gap * (len(lst) - 1) > avail:
            if min(want) > 2.2 and (avail - gap * (len(lst) - 1)) / sum(want) > 0.62:
                s = (avail - gap * (len(lst) - 1)) / sum(want)
                want = [w * s for w in want]
                break
            drop = min(range(len(lst)), key=lambda i: (lst[i][1]["brand"] != "", len(lst[i][1]["name"])))
            lst.pop(drop)
            want.pop(drop)
        if not lst:
            continue
        centres = []
        cur = 0.25
        for (tt, p), w in zip(lst, want):
            c = max(tt * L, cur + w / 2)
            centres.append(c)
            cur = c + w / 2 + gap
        over = cur - gap - (L - 0.25)
        if over > 0:
            lim = L - 0.25
            for i in range(len(centres) - 1, -1, -1):
                centres[i] = min(centres[i], lim - want[i] / 2)
                lim = centres[i] - want[i] / 2 - gap
        for (tt, p), w, c in zip(lst, want, centres):
            x, z = ax + dx * c, az + dz * c
            nx, nz = dz, -dx
            fx, fz = x + nx * 3.2, z + nz * 3.2
            dest = None
            if PLAY[0] + 25 < fx < PLAY[2] - 25 and PLAY[1] + 25 < fz < PLAY[3] - 25 and not all_b.contains(Point(fx, fz)):
                dest = [r2(fx), r2(fz)]
            signs.append({"n": p["name"], "k": p["kind"], "x": r2(x), "z": r2(z), "nx": round(nx, 4), "nz": round(nz, 4),
                          "w": r2(w), "b": int(j), "e": int(ei), "brand": p["brand"], "dest": dest,
                          "dm": r2(min(buildings[j]["dmain"], 999))})
    # keep the 512 that matter most (atlas capacity): in play first, then near main streets
    signs.sort(key=lambda s: (s["dest"] is None, s["dm"]))
    signs = signs[:768]
    print("signs", len(signs), "destinations", sum(1 for s in signs if s["dest"]))

    # ------------------------------------------------------ signals & crossings
    node_ways = defaultdict(list)
    for r in drive_roads:
        for i, n in enumerate(r["nodes"]):
            node_ways[n].append((r, i))

    def span_at(x, z, tx, tz):
        """Carriageway extent either side of (x,z) perpendicular to tangent."""
        px, pz = -tz, tx
        ext = []
        if not in_carriage(x, z):
            return None
        for sgn in (1, -1):
            d = 0.0
            while d < 16 and in_carriage(x + px * sgn * (d + 0.4), z + pz * sgn * (d + 0.4)):
                d += 0.4
            ext.append(d)
        return ext  # [towards +perp, towards -perp]

    sig_raw = []
    zebra = []
    signal_zone = play_box.buffer(60)
    for n in nodes.values():
        t = n.get("tags", {})
        hw = t.get("highway")
        is_sig = hw == "traffic_signals" or (hw == "crossing" and t.get("crossing") == "traffic_signals")
        is_zebra = hw == "crossing" and (t.get("crossing") in ("marked", "zebra", "uncontrolled") or t.get("crossing:markings") == "zebra")
        if not (is_sig or is_zebra) or n["id"] not in node_ways:
            continue
        x, z = pos[n["id"]]
        if not signal_zone.contains(Point(x, z)):
            continue
        if is_sig and len({r["name"] for r, _ in node_ways[n["id"]]}) > 1 and hw == "traffic_signals":
            continue  # a bare junction node: its arms carry their own crossings
        r, i = node_ways[n["id"]][0]
        a = r["pts"][max(0, i - 1)]
        b = r["pts"][min(len(r["pts"]) - 1, i + 1)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.1:
            continue
        tx, tz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        ext = span_at(x, z, tx, tz)
        if not ext:
            continue
        w = ext[0] + ext[1]
        if w < 3.2 or w > 30:
            continue
        cx, cz = x + (-tz) * (ext[0] - ext[1]) / 2, z + tx * (ext[0] - ext[1]) / 2
        rec = {"x": cx, "z": cz, "tx": tx, "tz": tz, "hw": w / 2, "cross": hw == "crossing", "name": r["name"], "main": r["name"] in MAIN}
        (sig_raw if is_sig else zebra).append(rec)

    # merge duplicates (dual carriageway halves, stop line + crossing pairs)
    sig_raw.sort(key=lambda s: (not s["cross"], -s["hw"]))
    signals = []
    for s in sig_raw:
        dup = False
        for o in signals:
            if abs(s["tx"] * o["tx"] + s["tz"] * o["tz"]) > 0.75 and math.hypot(s["x"] - o["x"], s["z"] - o["z"]) < 13:
                dup = True
                break
        if not dup:
            signals.append(s)
    zb = []
    for s in zebra:
        if any(math.hypot(s["x"] - o["x"], s["z"] - o["z"]) < 12 for o in signals + zb):
            continue
        zb.append(s)
    zebra = zb
    # cluster into junctions
    parent = list(range(len(signals)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(signals)):
        for j in range(i):
            if math.hypot(signals[i]["x"] - signals[j]["x"], signals[i]["z"] - signals[j]["z"]) < 40:
                parent[find(i)] = find(j)
    groups = defaultdict(list)
    for i in range(len(signals)):
        groups[find(i)].append(i)
    out_sig = []
    for gi, (root, idx) in enumerate(sorted(groups.items())):
        lead = max(idx, key=lambda i: (signals[i]["main"], signals[i]["hw"]))
        lt = signals[lead]
        phases = set()
        for i in idx:
            s = signals[i]
            ph = 0 if abs(s["tx"] * lt["tx"] + s["tz"] * lt["tz"]) > 0.7 else 1
            phases.add(ph)
            out_sig.append({"x": r2(s["x"]), "z": r2(s["z"]), "tx": round(s["tx"], 4), "tz": round(s["tz"], 4),
                            "hw": r2(s["hw"]), "j": gi, "ph": ph, "name": s["name"]})
        for o in out_sig:
            if o["j"] == gi:
                o["solo"] = len(phases) == 1
    out_zebra = [{"x": r2(s["x"]), "z": r2(s["z"]), "tx": round(s["tx"], 4), "tz": round(s["tz"], 4), "hw": r2(s["hw"])} for s in zebra]
    print("signals", len(out_sig), "junctions", len(groups), "zebras", len(out_zebra))

    # --------------------------------------------------------------- bus routes
    def centreline(name, axis, lo, hi, step=14.0, kind="primary"):
        """Average all carriageway points of a street into one centreline."""
        bins = defaultdict(list)
        for r in roads:
            if r["name"] != name or r["kind"] != kind:
                continue
            ls = LineString(r["pts"])
            d = 0.0
            while d <= ls.length:
                p = ls.interpolate(d)
                v = (p.x, p.y)
                bins[int(math.floor(v[axis] / step))].append(v)
                d += 2.0
        pts = []
        for k in sorted(bins):
            vs = bins[k]
            x = sum(v[0] for v in vs) / len(vs)
            z = sum(v[1] for v in vs) / len(vs)
            if lo <= (x, z)[axis] <= hi:
                pts.append((x, z))
        # light smoothing
        for _ in range(3):
            sm = [pts[0]]
            for i in range(1, len(pts) - 1):
                sm.append(((pts[i - 1][0] + 2 * pts[i][0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4))
            sm.append(pts[-1])
            pts = sm
        return pts

    # --- the pedestrianised stretch: whole street width, wall to wall, minus Regent Street
    regent_buf = unary_union([LineString(r["pts"]) for r in roads if r["name"] == "Regent Street" and r["kind"] == "primary"]).buffer(9.5)
    zone_axis = unary_union(zone_lines)
    zone_east = max(x for l in zone_lines for x, _ in l.coords)
    zone = zone_axis.buffer(17, cap_style="flat").difference(all_b).difference(regent_buf).intersection(scene_box)
    zone = zone.buffer(-0.5).buffer(0.5).simplify(0.2)
    zone_road = zone_axis.buffer(17, cap_style="flat").intersection(carriage).difference(regent_buf).buffer(-0.3).buffer(0.3).simplify(0.15)
    zone_centre = [p for p in centreline("Oxford Street", 0, SCENE[0] + 5, zone_east - 4) ]
    print("zone east end x", round(zone_east, 1), "area", round(zone.area))
    for sg in signs:
        if sg["dest"] and zone.buffer(4).contains(Point(sg["dest"])):
            sg["dest"] = None
    print("destinations outside the zone", sum(1 for sg in signs if sg["dest"]))

    # buses are diverted: Oxford Street east of the zone, turning up Great Portland Street
    ox_east = [p for p in centreline("Oxford Street", 0, zone_east + 6, SCENE[2] - 5)]
    gps = centreline("Great Portland Street", 1, SCENE[1] + 5, ox_east[0][1] - 8, kind="secondary")
    oxford = gps + ox_east
    for _ in range(3):  # round the corner (Chaikin)
        sm = [oxford[0]]
        for a, b in zip(oxford, oxford[1:]):
            sm.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
            sm.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
        sm.append(oxford[-1])
        oxford = sm
    regent = centreline("Regent Street", 1, SCENE[1] + 5, 548)
    for nm, line in (("oxford", oxford), ("regent", regent)):
        bad = sum(1 for p in line if not in_carriage(*p))
        print(nm, "centreline pts", len(line), "off-carriageway", bad)
    bus_routes = [
        {"street": "Oxford Street", "pts": [[r2(x), r2(z)] for x, z in oxford], "routes": ["55", "73", "98", "390", "139", "N207"]},
        {"street": "Regent Street", "pts": [[r2(x), r2(z)] for x, z in regent], "routes": ["88", "12", "94", "453", "159", "139"]},
    ]

    # --------------------------------------------------------------- road graph
    graph_box = play_box.buffer(15)
    gnodes = {}
    adj = defaultdict(set)
    for r in roads:
        if r["kind"] == "footway" or r["kind"] == "service":
            continue
        ns = r["nodes"]
        for a, b in zip(ns, ns[1:]):
            if a == b:
                continue
            if graph_box.contains(Point(pos[a])) and graph_box.contains(Point(pos[b])):
                adj[a].add(b)
                adj[b].add(a)
    # collapse degree-2 chains
    keep = {n for n in adj if len(adj[n]) != 2}
    edges = []
    visited = set()
    for n in keep:
        for nb in adj[n]:
            if (n, nb) in visited:
                continue
            chain = [n, nb]
            visited.add((n, nb))
            while chain[-1] not in keep:
                nxt = [m for m in adj[chain[-1]] if m != chain[-2]]
                if not nxt:
                    break
                chain.append(nxt[0])
            visited.add((chain[-1], chain[-2]))
            if chain[-1] in keep and chain[0] != chain[-1]:
                edges.append(chain)
    idx = {}
    gn = []
    for ch in edges:
        for n in (ch[0], ch[-1]):
            if n not in idx:
                idx[n] = len(gn)
                gn.append([r2(pos[n][0]), r2(pos[n][1])])
    gedges = [{"a": idx[ch[0]], "b": idx[ch[-1]], "p": [[r2(pos[n][0]), r2(pos[n][1])] for n in ch]} for ch in edges]
    print("graph nodes", len(gn), "edges", len(gedges))

    # ------------------------------------------------------------- street names
    plates = []
    for r in roads:
        if not r["name"] or r["kind"] in ("footway", "service"):
            continue
        ls = LineString(r["pts"])
        if ls.length < 25:
            continue
        for d in (9.0, ls.length - 9.0):
            p = ls.interpolate(d)
            q = ls.interpolate(min(ls.length, d + 1.0))
            o = ls.interpolate(max(0.0, d - 1.0))
            tx, tz = q.x - o.x, q.y - o.y
            tl = math.hypot(tx, tz) or 1
            tx, tz = tx / tl, tz / tl
            if not play_box.buffer(40).contains(p):
                continue
            best = None
            for j in b_tree.query(p.buffer(18)):
                if buildings[j]["mh"] > 1 or buildings[j]["h"] < 7:
                    continue
                for (ax, az, bx, bz, L, facing) in edge_info[j]:
                    if not facing or L < 3:
                        continue
                    dx, dz = (bx - ax) / L, (bz - az) / L
                    if abs(dx * tx + dz * tz) < 0.88:
                        continue
                    tt = max(0.12, min(0.88, ((p.x - ax) * dx + (p.y - az) * dz) / L))
                    wx, wz = ax + dx * tt * L, az + dz * tt * L
                    # the wall must face the street
                    if (p.x - wx) * dz + (p.y - wz) * (-dx) < 1:
                        continue
                    dd = math.hypot(p.x - wx, p.y - wz)
                    if dd < 18 and (best is None or dd < best[0]):
                        best = (dd, wx, wz, dz, -dx)
            if best and not any(pl["n"] == r["name"] and math.hypot(pl["x"] - best[1], pl["z"] - best[2]) < 45 for pl in plates):
                plates.append({"n": r["name"], "x": r2(best[1]), "z": r2(best[2]), "nx": round(best[3], 4), "nz": round(best[4], 4)})
    print("street name plates", len(plates))

    # ------------------------------------------------------------ street lamps
    lamps = []
    lamp_zone = play_box.buffer(120)
    for r in drive_roads:
        if r["kind"] == "service":
            continue
        ls = LineString(r["pts"])
        step = 26.0 if r["kind"] == "primary" else 30.0
        d = step * (0.3 + 0.5 * h01(r["id"], "lamp"))
        k = int(h01(r["id"], "side") * 2)
        while d < ls.length - 4:
            p = ls.interpolate(d)
            q = ls.interpolate(d + 1.0)
            tx, tz = q.x - p.x, q.y - p.y
            tl = math.hypot(tx, tz) or 1
            tx, tz = tx / tl, tz / tl
            d += step
            k += 1
            if not lamp_zone.contains(p):
                continue
            ext = span_at(p.x, p.y, tx, tz)
            if not ext:
                continue
            sgn = 1 if k % 2 else -1
            e = ext[0] if sgn > 0 else ext[1]
            lx, lz = p.x + (-tz) * sgn * (e + 0.75), p.y + tx * sgn * (e + 0.75)
            pt = Point(lx, lz)
            if all_b.distance(pt) < 0.8 or carriage.contains(pt):
                continue
            if any(math.hypot(lx - o[0], lz - o[1]) < 14 for o in lamps):
                continue
            lamps.append([r2(lx), r2(lz), round(-tz * -sgn, 3), round(tx * -sgn, 3)])  # arm points back over the road
    print("lamps", len(lamps))

    # ------------------------------------------------------------------- props
    props = defaultdict(list)
    prop_zone = play_box.buffer(140)
    for n in nodes.values():
        t = n.get("tags", {})
        x, z = pos[n["id"]]
        if not prop_zone.contains(Point(x, z)):
            continue
        k = None
        if t.get("natural") == "tree":
            k = "tree"
        elif t.get("amenity") == "post_box":
            k = "postbox"
        elif t.get("amenity") == "telephone":
            k = "phone"
        elif t.get("amenity") == "bench":
            k = "bench"
        elif t.get("amenity") == "bicycle_rental":
            k = "dock"
        elif t.get("amenity") == "bicycle_parking":
            k = "rack"
        elif t.get("amenity") == "waste_basket":
            k = "bin"
        elif t.get("railway") == "subway_entrance":
            k = "tube"
        elif t.get("highway") == "bus_stop":
            k = "busstop"
        if not k:
            continue
        pt = Point(x, z)
        if k != "tube" and (all_b.distance(pt) < 0.3):
            continue
        rec = [r2(x), r2(z)]
        if k in ("tube", "busstop"):
            rec.append(t.get("name", ""))
        props[k].append(rec)
    print({k: len(v) for k, v in props.items()})

    # ------------------------------------------------------------ double yellows
    yl = []
    mainbuf = unary_union([main_lines[n] for n in MAIN]).buffer(15)
    from shapely.ops import linemerge
    kerb_all = pavement.boundary.intersection(play_box.buffer(60))
    for main, geom in ((0, kerb_all.difference(mainbuf)), (1, kerb_all.intersection(mainbuf))):
        if geom.geom_type == "MultiLineString":
            geom = linemerge(geom)
        for g in (geom.geoms if hasattr(geom, "geoms") else [geom]):
            if g.geom_type != "LineString" or g.length < 8:
                continue
            c = list(g.coords)
            yl.append({"m": main, "p": [v for x, z in c for v in (r2(x), r2(z))]})

    # ---------------------------------------------------------------- road list
    out_roads = []
    for r in roads:
        ls = LineString(r["pts"])
        if not ls.intersects(scene_box):
            continue
        out_roads.append({"n": r["name"], "k": r["kind"], "w": r2(r["width"]), "o": 1 if r["oneway"] else 0,
                          "p": [v for x, z in r["pts"] for v in (r2(x), r2(z))]})

    scene = {
        "origin": {"lat": LAT0, "lon": LON0},
        "play": PLAY,
        "scene": SCENE,
        "pavement": poly_out(pavement),
        "zone": poly_out(zone),
        "zoneRoad": poly_out(zone_road),
        "zoneCentre": [[r2(x), r2(z)] for x, z in zone_centre],
        "zoneEast": r2(zone_east),
        "ped": poly_out(ped),
        "green": poly_out(green),
        "roads": out_roads,
        "buildings": out_b,
        "signs": signs,
        "signals": out_sig,
        "zebras": out_zebra,
        "busRoutes": bus_routes,
        "graph": {"nodes": gn, "edges": gedges},
        "plates": plates,
        "lamps": lamps,
        "props": props,
        "kerbs": yl,
        "attribution": "Map data © OpenStreetMap contributors (ODbL)",
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(scene, f, separators=(",", ":"))
    print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
    print("pavement polys", len(scene["pavement"]), "verts", sum(len(r) // 2 for p in scene["pavement"] for r in p))


if __name__ == "__main__":
    main()
