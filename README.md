# Rural Address Lookup

A small web app that turns GPS coordinates into an Alberta-style rural
address suitable for shippers (e.g. `9001 Township Road 365`).

**Live site:** https://natt368.github.io/Lat-Long_to-Rural-Address/

Paste in coordinates exactly as Google Maps copies them (`56.071708,
-120.266439`) and the app looks up two things in parallel:

1. **Alberta Township System (ATS)** — queries the Government of Alberta's
   public survey-grid service to get the exact Meridian/Range/Township/Section
   for that point, then derives the nearest Township Road and Range Road
   names (the same numbers used on the blue rural address signs) and an
   estimated civic (911) number using Alberta's standard addressing formula
   (each mile split into 40 units of 132 ft; odd numbers on the south side of
   township roads and the east side of range roads, even on the opposite
   side).
2. **OpenStreetMap (Nominatim)** — a general reverse-geocode, useful as a
   cross-check and for places where OSM already has the road tagged directly.

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
  from the Government of Alberta's official survey-grid dataset, so it
  should be exact.
- The **Township Road / Range Road names** are derived from that same
  official data using Alberta's documented numbering convention, so they
  should match the real road names in the vast majority of cases.
- The **civic (911) number** is a best-effort estimate computed from
  geometry. The actual number on a farm's sign is officially assigned and
  recorded by that rural municipality/county — it's normally very close to
  this estimate, but can differ by a unit or two, and this app has no way to
  look up the county's authoritative address-point database directly. If you
  test this against a real, known sign and the number is off, that's useful
  feedback for refining the formula.
- The Alberta lookup only works for points inside Alberta's DLS survey grid.
  Outside Alberta, only the OpenStreetMap result will be useful.
- Both lookups go directly from your browser to the respective public APIs —
  no API key is required for either.
