# Rural Address Lookup

A small web app that turns GPS coordinates into a rural address suitable for
shippers (e.g. `9001 Township Rd. 365`).

Enter a latitude and longitude, and the app reverse-geocodes the point using
[OpenStreetMap's Nominatim service](https://nominatim.org/) and displays the
nearest road name and house number, along with county/state/postal context.

## Running it

This is a static site with no build step or backend. Any of these work:

- Open `index.html` directly in a browser, or
- Serve the folder locally, e.g.:

  ```sh
  python3 -m http.server 8000
  ```

  then visit `http://localhost:8000`.

## Notes and limitations

- Rural/township road coverage depends entirely on what's mapped in
  OpenStreetMap for that area. Coverage is generally good in the US Midwest
  but can be sparse elsewhere — if no road is found, the app will say so.
- Lookups go directly from your browser to Nominatim's public API, so no
  API key is required. Please keep usage light (a request or two at a time)
  per [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/).
- Nominatim's `house_number` field reflects whatever address point OSM has
  closest to your coordinates — for very rural areas without mapped
  addresses, you may only get a road name with no house number.
