# Rural Address Lookup

A small web app that turns GPS coordinates into a rural address suitable for
shippers (e.g. `9001 Township Road 365`), covering British Columbia,
Alberta, Saskatchewan, Manitoba, and Ontario.

**Live site:** https://natt368.github.io/Lat-Long_to-Rural-Address/

Paste in coordinates exactly as Google Maps copies them (`56.071708,
-120.266439`). The app first reverse-geocodes the point with OpenStreetMap
to find which province it's in, then:

1. **Alberta or Saskatchewan** — queries that province's public
   Dominion Land Survey (DLS) grid service to get the exact
   Meridian/Range/Township/Section for the point, derives the nearest
   Township Road and Range Road names (the same numbers used on the blue
   rural address signs), and estimates a civic (911) number using that
   province's addressing formula. Alberta and Saskatchewan agree on how
   Range Roads are numbered (odd on the east side) but disagree on Township
   Roads (Alberta: odd on the south side; Saskatchewan: odd on the north
   side) — the app accounts for the difference.
2. **BC's Peace River Regional District** (the Fort St. John / Dawson Creek
   area — the one part of BC on the DLS grid) — queries the district's own
   public civic-addressing GIS layer directly, so this returns the real
   assigned address rather than an estimate.
3. **Everywhere else in BC, plus Manitoba and Ontario** — these don't have a
   consistent addressing scheme this app can compute (the rest of BC isn't
   on the DLS grid at all; Manitoba addressing varies by municipality, some
   using a Township/Range scheme and others an unrelated "gate address"
   format; Ontario uses a concession-and-lot survey system with ordinary
   named-road addressing). For these, only the OpenStreetMap result applies.

In all cases, **OpenStreetMap (Nominatim)** is also shown as a general
reverse-geocode and cross-check, useful especially where OSM already has
the road tagged directly.

## Running it

This is a static site with no build step or backend. Any of these work:

- Open `index.html` directly in a browser, or
- Serve the folder locally, e.g.:

  ```sh
  python3 -m http.server 8000
  ```

  then visit `http://localhost:8000`.

## Accuracy notes

- The **legal location** (Section-Township-Range-Meridian) comes directly
  from each province's official survey-grid dataset, so it should be exact
  for Alberta and Saskatchewan.
- The **Township Road / Range Road names** are derived from that same
  official data using each province's documented numbering convention, so
  they should match the real road names in the vast majority of cases.
- The **civic (911) number** is a best-effort estimate computed from
  geometry. The actual number on a farm's sign is officially assigned and
  recorded by that rural municipality/county — it's normally very close to
  this estimate, but can differ by a unit or two, and this app has no way to
  look up the county's authoritative address-point database directly. If you
  test this against a real, known sign and the number is off, that's useful
  feedback for refining the formula.
- The **Peace River Regional District civic address** comes from the
  district's own published address-point data, so when a nearby point
  exists it should be the real, official address - not an estimate. This
  integration is newer and less battle-tested than the Alberta/Saskatchewan
  one, since the district doesn't document its data layer's exact field
  names publicly.
- For the rest of BC, Manitoba, and Ontario, only the OpenStreetMap result
  is shown — see above for why a computed grid address isn't offered there.
- All lookups go directly from your browser to the respective public APIs —
  no API key is required for any of them.
