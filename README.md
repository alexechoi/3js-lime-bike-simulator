# Lime Bike Simulator: Soho

Ride a Lime e-bike round a real map of Oxford Circus and Soho, built with Next.js and three.js.
Deliver each order to the glowing pin before the clock runs out.

```bash
npm install
npm run dev      # http://localhost:3000
```

## How to play

- **W A S D / arrow keys** ride and steer, **Space** brakes, **Enter** starts or restarts.
- Each job has two legs: collect the order from a real restaurant or cafe (amber pin), then deliver it to the customer (green pin). Both legs add time; you start with 90 seconds.
- Red double-deckers run on Regent Street and, diverted up Great Portland Street, the open end of Oxford Street. Hit one and it is over ("Flattened by the 88").
- Black cabs, vans and cars drive the open streets. They queue at lights and brake for what is ahead of them, not for a courier coming at their side.
- Traffic lights: you can jump a red, but people cross on red, some jaywalk anyway, and hitting a pedestrian ends the ride.
- A police car patrols. If it sees you jump a red it chases you for 10 seconds.
- Oxford Street west of Great Portland Street went traffic-free on 26 October 2026 and cycling is banned there. Security guards in hi-vis patrol it; they shout, give chase and tackle.
- Bollards, bins, lamp posts, planters and cafe tables are solid.
- The battery drains as you ride and the motor fades when it is low. Pick up the green cells.
- Leave the Lime service zone (the green wall) and the motor cuts out.
- Crashes play out in slow motion before the results card appears.
- **Flythrough**: press **F** on the menu (or the "Watch the flythrough" button, or open `/?demo`) for a looping, letterboxed tour with the bike riding itself, including staged slow-motion crashes: a bus, a pedestrian and a security tackle. **Esc** exits.

## The map is real

Everything comes from OpenStreetMap: street centrelines, 2,900 building footprints with their heights and
materials, traffic signals and crossings, trees, post boxes, phone boxes, tube entrances, and the names of
about 770 shops, cafes and pubs, which appear on the fascias where they really are and are used as delivery
addresses.

```bash
pip install shapely pillow
python pipeline/fetch_osm.py    # optional: refresh data/raw/soho-osm.json from the OSM API
python pipeline/build_map.py    # -> public/data/soho.json
python pipeline/preview.py      # -> docs/preview.png (top-down check)
```

`data/raw/soho-osm.json.gz` is the extract the committed scene was built from.

## Layout

```
pipeline/        OSM download and the build step (kerbs, pavements, signals, shop signs, bus routes)
app/LimeGame.tsx React shell and HUD
game/game.ts     loop, bike physics, signals, buses, police, deliveries, minimap; dispose() cleans everything up
game/world.ts    ground, wet-street shading, baked ground AO, road markings, buildings, sky and light
game/facade.ts   procedural facade shader: shopfronts with interiors, sash windows, cornices, mansards
game/signs.ts    shop fascias, blade signs, awnings, Westminster street nameplates
game/props.ts    signals, lamps, bollards, bins, cafe tables, trees, tube roundels, zone gateways
game/peds.ts     pedestrians, crossing groups, security guards
game/trees.ts    street trees grown with ez-tree, instanced
game/bike.ts     the bike and rider
game/vehicles.ts buses, police car, taxis, vans and cars
game/traffic.ts  ordinary traffic on the road graph
```

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
- Textures: [Poly Haven](https://polyhaven.com) (CC0) — asphalt_02, concrete_pavement_02, red_brick_03,
  yellow_bricks, brown_brick_02, white_sandstone_blocks_02, roof_slates_02, chinese_hackberry_bark.
- Characters: [Quaternius](https://quaternius.com) (CC0).
- Trees: [ez-tree](https://github.com/dgreenheck/ez-tree) by Daniel Greenheck (MIT).
- three.js (MIT).

Not affiliated with Lime, TfL or anyone whose shop sign appears in it.
