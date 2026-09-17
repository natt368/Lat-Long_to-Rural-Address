const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const FEET_PER_DEGREE_LAT = 365221;
const UNIT_FEET = 132; // each civic-numbering unit along a road allowance

// Alberta and Saskatchewan both use the Dominion Land Survey grid and a
// "Township Road ###" / "Range Road ###" civic addressing scheme, but they
// disagree on which side of a *township* road is odd vs even (range-road
// parity happens to agree). British Columbia's DLS coverage is limited to
// the Peace River Block and isn't handled here; Manitoba's civic numbering
// varies by municipality (some use this scheme, others use an unrelated
// "gate address" format) so it isn't safe to guess. Ontario doesn't use a
// township/range grid for addressing at all.
const PROVINCE_CONFIG = {
  Alberta: {
    identifyUrl: "https://maps.alberta.ca/genesis/rest/services/Alberta_Township_System/Latest/MapServer/identify",
    meridianLabel: (m) => `W${m}M`,
    townshipRoadOddSide: "south",
    rangeRoadOddSide: "east",
  },
  Saskatchewan: {
    identifyUrl: "https://gis.saskatchewan.ca/arcgis/rest/services/CadastreSection/MapServer/identify",
    meridianLabel: (m) => `W${m}`,
    townshipRoadOddSide: "north",
    rangeRoadOddSide: "east",
  },
};

// BC has no province-wide DLS grid, but the Peace River Block (the one part
// of BC that does use the DLS grid) is administered by the Peace River
// Regional District, which publishes its own assigned 911 civic addresses
// directly - so rather than estimate a number, we look up the real one.
const PRRD_IDENTIFY_URL = "https://webmap.prrd.bc.ca/ags/rest/services/Geocortex/PRRD_Public/MapServer/identify";

function isPeaceRiverRegion(address) {
  const haystack = `${address.county || ""} ${address.state_district || ""}`.toLowerCase();
  return haystack.includes("peace river");
}

const form = document.getElementById("lookup-form");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const gridHeadingEl = document.getElementById("grid-heading");
const legalDescriptionEl = document.getElementById("legal-description");
const atsCandidatesEl = document.getElementById("ats-candidates");
const osmAddressEl = document.getElementById("osm-address");
const osmDetailsEl = document.getElementById("osm-details");
const fullNameEl = document.getElementById("full-name");

function setStatus(message, isError) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

function parseCoordinates(raw) {
  const match = raw.trim().match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  return { lat, lon };
}

// Sections snake from 1 (SE corner) west across row 1, then east across row 2, etc.
// Returns 0-based row (0 = southernmost mile of the township) and column-from-east (0 = easternmost mile of the range).
function sectionRowColumn(section) {
  const idx = section - 1;
  const row = Math.floor(idx / 6);
  const posInRow = idx % 6;
  const columnFromEast = row % 2 === 0 ? posInRow : 5 - posInRow;
  return { row, columnFromEast };
}

function gridRoadNumber(base, offset) {
  return offset >= 6 ? (base + 1) * 10 : base * 10 + offset;
}

// Civic number per the prairie rural addressing standard: the road number is
// the cross-road you're nearest the start of, followed by a 2-digit lot
// (01-80, one every 132 ft = 1/40th of a mile) counted away from it.
function civicLotNumber(distanceFeet, isOddSide) {
  const unit = Math.min(40, Math.max(1, Math.round(distanceFeet / UNIT_FEET) || 1));
  const lot = isOddSide ? unit * 2 - 1 : unit * 2;
  return String(lot).padStart(2, "0");
}

function findAttr(attrs, cues) {
  const key = Object.keys(attrs).find((k) => {
    const tokens = k.toUpperCase().split(/[^A-Z0-9]+/);
    return cues.some((cue) => tokens.includes(cue));
  });
  return key ? attrs[key] : undefined;
}

async function lookupSurveyGrid(lat, lon, identifyUrl) {
  const delta = 0.01;
  const url = new URL(identifyUrl);
  url.searchParams.set("geometry", `${lon},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("sr", "4326");
  url.searchParams.set("layers", "all");
  url.searchParams.set("tolerance", "2");
  url.searchParams.set("mapExtent", `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`);
  url.searchParams.set("imageDisplay", "600,600,96");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("f", "json");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Survey grid lookup failed (HTTP ${response.status}).`);
  }
  const data = await response.json();
  const results = data.results || [];

  const sectionResult = results.find((r) => {
    if (!r.attributes || !r.geometry || !r.geometry.rings) return false;
    return (
      findAttr(r.attributes, ["SEC", "SECTION"]) !== undefined &&
      findAttr(r.attributes, ["TWP", "TOWNSHIP"]) !== undefined &&
      findAttr(r.attributes, ["RGE", "RANGE"]) !== undefined
    );
  });

  if (!sectionResult) {
    return null;
  }

  const meridian = Number(findAttr(sectionResult.attributes, ["M", "MER", "MERIDIAN"]));
  const range = Number(findAttr(sectionResult.attributes, ["RGE", "RANGE"]));
  const township = Number(findAttr(sectionResult.attributes, ["TWP", "TOWNSHIP"]));
  const section = Number(findAttr(sectionResult.attributes, ["SEC", "SECTION"]));

  const points = sectionResult.geometry.rings.flat();
  const lats = points.map((p) => p[1]);
  const lons = points.map((p) => p[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  const feetPerDegreeLon = FEET_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);

  return {
    meridian,
    range,
    township,
    section,
    distSouthFt: (lat - minLat) * FEET_PER_DEGREE_LAT,
    distNorthFt: (maxLat - lat) * FEET_PER_DEGREE_LAT,
    distEastFt: (maxLon - lon) * feetPerDegreeLon,
    distWestFt: (lon - minLon) * feetPerDegreeLon,
  };
}

// Combines the survey-grid location with a province's addressing rules to
// estimate the nearest Township Road / Range Road civic addresses. The
// reference cross-road for each is always the one at the start of its mile
// segment (the range road you're east of; the township road you're north
// of), with the lot number counted away from that reference.
function computeGridRoads(grid, config) {
  const { row, columnFromEast } = sectionRowColumn(grid.section);

  const southTwpRd = gridRoadNumber(grid.township, row);
  const northTwpRd = gridRoadNumber(grid.township, row + 1);
  const eastRgeRd = gridRoadNumber(grid.range, columnFromEast);
  const westRgeRd = gridRoadNumber(grid.range, columnFromEast + 1);

  const pointIsNorthOfSouthTwpRd = grid.distSouthFt <= grid.distNorthFt;
  const nearestTwpRdNumber = pointIsNorthOfSouthTwpRd ? southTwpRd : northTwpRd;
  const pointIsSouthOfTwpRd = !pointIsNorthOfSouthTwpRd; // i.e. nearest edge is the northern one
  const twpRoadIsOdd = config.townshipRoadOddSide === "south" ? pointIsSouthOfTwpRd : !pointIsSouthOfTwpRd;

  const pointIsEastOfWestRgeRd = grid.distEastFt > grid.distWestFt;
  const nearestRgeRdNumber = pointIsEastOfWestRgeRd ? westRgeRd : eastRgeRd;
  const pointIsWestOfRgeRd = !pointIsEastOfWestRgeRd; // i.e. nearest edge is the eastern one
  const rgeRoadIsOdd = config.rangeRoadOddSide === "east" ? !pointIsWestOfRgeRd : pointIsWestOfRgeRd;

  return {
    townshipRoad: { number: nearestTwpRdNumber, civic: `${westRgeRd}${civicLotNumber(grid.distWestFt, twpRoadIsOdd)}` },
    rangeRoad: { number: nearestRgeRdNumber, civic: `${southTwpRd}${civicLotNumber(grid.distSouthFt, rgeRoadIsOdd)}` },
  };
}

const PROVINCE_ALIASES = {
  Alberta: "Alberta",
  Saskatchewan: "Saskatchewan",
  Manitoba: "Manitoba",
  Ontario: "Ontario",
  "British Columbia": "British Columbia",
};

function renderGridSection(province, ats) {
  gridHeadingEl.textContent = province ? `Dominion Land Survey grid (${province})` : "Dominion Land Survey grid";

  if (!PROVINCE_CONFIG[province]) {
    legalDescriptionEl.textContent = province
      ? `${province} doesn't have a consistent province-wide grid addressing system this app can compute - see the OpenStreetMap result below.`
      : "Could not determine the province for this point.";
    atsCandidatesEl.innerHTML = "";
    return;
  }

  if (!ats) {
    legalDescriptionEl.textContent = `Could not determine a legal land location for this point (it may be outside ${province}'s survey grid).`;
    atsCandidatesEl.innerHTML = "";
    return;
  }

  const config = PROVINCE_CONFIG[province];
  const roads = computeGridRoads(ats, config);

  legalDescriptionEl.textContent = `Section ${ats.section}, Township ${ats.township}, Range ${ats.range}, ${config.meridianLabel(ats.meridian)}`;

  atsCandidatesEl.innerHTML = "";
  const rows = [
    ["Nearest Township Road", `~${roads.townshipRoad.civic} Township Road ${roads.townshipRoad.number}`],
    ["Nearest Range Road", `~${roads.rangeRoad.civic} Range Road ${roads.rangeRoad.number}`],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    atsCandidatesEl.append(dt, dd);
  }
}

// Looks up an authoritative, already-assigned civic address point (as
// opposed to computing an estimate from survey geometry). Used for the
// Peace River Regional District's own "911 Civic Address" layer, which
// isn't split into predictable field names, so we take whatever the
// identify operation's own display value for that feature is.
async function lookupPointAddress(lat, lon, identifyUrl) {
  const delta = 0.01;
  const url = new URL(identifyUrl);
  url.searchParams.set("geometry", `${lon},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("sr", "4326");
  url.searchParams.set("layers", "all");
  url.searchParams.set("tolerance", "15");
  url.searchParams.set("mapExtent", `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`);
  url.searchParams.set("imageDisplay", "600,600,96");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Civic address lookup failed (HTTP ${response.status}).`);
  }
  const data = await response.json();
  const results = data.results || [];

  const addressResult = results.find(
    (r) => /civic address/i.test(r.layerName || "") && !/label/i.test(r.layerName || "")
  );

  if (!addressResult) return null;
  return { value: addressResult.value, attributes: addressResult.attributes || {} };
}

function renderPointAddress(sourceLabel, result) {
  gridHeadingEl.textContent = `Regional civic address (${sourceLabel})`;

  if (!result) {
    legalDescriptionEl.textContent = `No assigned civic address point was found near this location in ${sourceLabel}'s data - see the OpenStreetMap result below.`;
    atsCandidatesEl.innerHTML = "";
    return;
  }

  legalDescriptionEl.textContent = result.value || "Found a nearby address point, but couldn't read its address value.";

  atsCandidatesEl.innerHTML = "";
  for (const [key, value] of Object.entries(result.attributes)) {
    if (value === null || value === "") continue;
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    atsCandidatesEl.append(dt, dd);
  }
}

function buildOsmAddress(address) {
  const road = address.road;
  if (!road) return null;
  return address.house_number ? `${address.house_number} ${road}` : road;
}

function renderOsmDetails(address) {
  osmDetailsEl.innerHTML = "";
  const fields = [
    ["County", address.county],
    ["Town/Township", address.town || address.village || address.hamlet || address.township],
    ["State/Province", address.state],
    ["Postal Code", address.postcode],
    ["Country", address.country],
  ];
  for (const [label, value] of fields) {
    if (!value) continue;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    osmDetailsEl.append(dt, dd);
  }
}

async function lookupOsm(lat, lon) {
  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`OpenStreetMap lookup failed (HTTP ${response.status}).`);
  }
  return response.json();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const coords = parseCoordinates(document.getElementById("coords").value);
  if (!coords) {
    setStatus("Please enter valid coordinates, e.g. 56.071708, -120.266439", true);
    resultEl.classList.add("hidden");
    return;
  }

  const { lat, lon } = coords;

  submitBtn.disabled = true;
  resultEl.classList.add("hidden");
  setStatus("Looking up address...", false);

  let osmData = null;
  let osmError = null;
  try {
    osmData = await lookupOsm(lat, lon);
  } catch (err) {
    osmError = err;
  }

  resultEl.classList.remove("hidden");

  const rawState = osmData && osmData.address ? osmData.address.state : null;
  const province = rawState ? PROVINCE_ALIASES[rawState] || rawState : null;

  if (PROVINCE_CONFIG[province]) {
    setStatus("Looking up survey grid...", false);
    try {
      const grid = await lookupSurveyGrid(lat, lon, PROVINCE_CONFIG[province].identifyUrl);
      renderGridSection(province, grid);
    } catch (err) {
      gridHeadingEl.textContent = `Dominion Land Survey grid (${province})`;
      legalDescriptionEl.textContent = "Survey grid lookup failed: " + err.message;
      atsCandidatesEl.innerHTML = "";
    }
  } else if (province === "British Columbia" && osmData && osmData.address && isPeaceRiverRegion(osmData.address)) {
    setStatus("Looking up regional civic address...", false);
    try {
      const pointResult = await lookupPointAddress(lat, lon, PRRD_IDENTIFY_URL);
      renderPointAddress("Peace River Regional District", pointResult);
    } catch (err) {
      gridHeadingEl.textContent = "Regional civic address (Peace River Regional District)";
      legalDescriptionEl.textContent = "Civic address lookup failed: " + err.message;
      atsCandidatesEl.innerHTML = "";
    }
  } else {
    renderGridSection(province, null);
  }

  setStatus("", false);

  if (osmError) {
    osmAddressEl.textContent = "OpenStreetMap lookup failed: " + osmError.message;
    osmDetailsEl.innerHTML = "";
    fullNameEl.textContent = "";
  } else if (osmData.error || !osmData.address) {
    osmAddressEl.textContent = "No OpenStreetMap address found for this location.";
    osmDetailsEl.innerHTML = "";
    fullNameEl.textContent = "";
  } else {
    osmAddressEl.textContent = buildOsmAddress(osmData.address) || "No specific road found near this point.";
    renderOsmDetails(osmData.address);
    fullNameEl.textContent = osmData.display_name || "";
  }

  submitBtn.disabled = false;
});
