"""Download raw OpenStreetMap data for Oxford Circus / Soho.

Uses the plain OSM API map call in small tiles (it caps each request at
50k nodes) and merges them into data/raw/soho-osm.json.

    python pipeline/fetch_osm.py
"""
import json
import os
import time
import urllib.request

# west, south, east, north. Wider than the playable area so the streets
# have real buildings to look at beyond the barriers.
BBOX = (-0.1492, 51.5082, -0.1268, 51.5202)
NX, NY = 5, 4
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "raw", "soho-osm.json")


def main():
    w0, s0, e0, n0 = BBOX
    els = {}
    for i in range(NX):
        for j in range(NY):
            w = w0 + (e0 - w0) * i / NX
            e = w0 + (e0 - w0) * (i + 1) / NX
            s = s0 + (n0 - s0) * j / NY
            n = s0 + (n0 - s0) * (j + 1) / NY
            url = f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w:.5f},{s:.5f},{e:.5f},{n:.5f}"
            for attempt in range(5):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "soho-map-fetch/1.0"})
                    data = json.load(urllib.request.urlopen(req, timeout=180))
                    break
                except Exception as ex:  # noqa: BLE001
                    print("retry", ex)
                    time.sleep(4 * (attempt + 1))
            else:
                raise SystemExit("failed " + url)
            for el in data["elements"]:
                els[(el["type"], el["id"])] = el
            print(f"tile {i},{j}: {len(data['elements'])} elements, {len(els)} total")
            time.sleep(1)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump({"bbox": BBOX, "elements": list(els.values())}, f)
    print("wrote", OUT, os.path.getsize(OUT))


if __name__ == "__main__":
    main()
