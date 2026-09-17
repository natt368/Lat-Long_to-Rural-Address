const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const ATS_IDENTIFY_URL = "https://maps.alberta.ca/genesis/rest/services/Alberta_Township_System/Latest/MapServer/identify";
const FEET_PER_DEGREE_LAT = 365221;
const FEET_PER_MILE = 5280;
const UNIT_FEET = 132; // each civic-numbering unit along a road allowance

const form = document.getElementById("lookup-form");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
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

// Civic number per the Alberta rural addressing standard: each mile is split into
// 40 units of 132 ft. Units are odd (1-79) on the south side of township roads and
// the east side of range roads; even (2-80) on the opposite side.
function civicUnitNumber(distanceFeet, isOddSide) {
  const unit = Math.min(40, Math.max(1, Math.round(distanceFeet / UNIT_FEET) || 1));
  return isOddSide ? unit * 2 - 1 : unit * 2;
}

async function lookupATS(lat, lon) {
  const delta = 0.01;
  const url = new URL(ATS_IDENTIFY_URL);
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
    throw new Error(`Alberta Township System lookup failed (HTTP ${response.status}).`);
  }
  const data = await response.json();
  const results = data.results || [];

  const findAttr = (attrs, candidates) => {
    const key = Object.keys(attrs).find((k) => candidates.includes(k.toUpperCase()));
    return key ? attrs[key] : undefined;
  };

  const sectionResult = results.find((r) => {
    if (!r.attributes) return false;
    return (
      findAttr(r.attributes, ["SEC", "SECTION"]) !== undefined &&
      findAttr(r.attributes, ["TWP", "TOWNSHIP"]) !== undefined &&
      findAttr(r.attributes, ["RGE", "RANGE"]) !== undefined &&
      r.geometry &&
      r.geometry.rings
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

  const distSouthFt = (lat - minLat) * FEET_PER_DEGREE_LAT;
  const distNorthFt = (maxLat - lat) * FEET_PER_DEGREE_LAT;
  const distEastFt = (maxLon - lon) * feetPerDegreeLon;
  const distWestFt = (lon - minLon) * feetPerDegreeLon;

  const { row, columnFromEast } = sectionRowColumn(section);

  const southTwpRd = gridRoadNumber(township, row);
  const northTwpRd = gridRoadNumber(township, row + 1);
  const eastRgeRd = gridRoadNumber(range, columnFromEast);
  const westRgeRd = gridRoadNumber(range, columnFromEast + 1);

  // Being closest to the section's south edge means the point sits *north* of
  // that road (and vice versa) - the civic-number parity rule is about which
  // side of the road the point is on, so it's the opposite of the closer edge.
  const nearestTwpRd = distSouthFt <= distNorthFt
    ? { number: southTwpRd, distanceFeet: distSouthFt, pointIsNorthOfRoad: true }
    : { number: northTwpRd, distanceFeet: distNorthFt, pointIsNorthOfRoad: false };

  const nearestRgeRd = distEastFt <= distWestFt
    ? { number: eastRgeRd, distanceFeet: distEastFt, pointIsWestOfRoad: true }
    : { number: westRgeRd, distanceFeet: distWestFt, pointIsWestOfRoad: false };

  // Position *along* each road is measured using distance from the perpendicular grid line.
  // Odd numbers: south side of township roads, east side of range roads.
  const twpCivic = civicUnitNumber(
    distEastFt <= distWestFt ? distEastFt : distWestFt,
    !nearestTwpRd.pointIsNorthOfRoad
  );
  const rgeCivic = civicUnitNumber(
    distSouthFt <= distNorthFt ? distSouthFt : distNorthFt,
    !nearestRgeRd.pointIsWestOfRoad
  );

  return {
    meridian,
    range,
    township,
    section,
    townshipRoad: { civic: twpCivic, number: nearestTwpRd.number },
    rangeRoad: { civic: rgeCivic, number: nearestRgeRd.number },
  };
}

function renderATS(ats) {
  if (!ats) {
    legalDescriptionEl.textContent = "Could not determine a legal land location for this point (it may be outside Alberta's survey grid).";
    atsCandidatesEl.innerHTML = "";
    return;
  }

  legalDescriptionEl.textContent = `Section ${ats.section}, Township ${ats.township}, Range ${ats.range}, W${ats.meridian}M`;

  atsCandidatesEl.innerHTML = "";
  const rows = [
    ["Nearest Township Road", `~${ats.townshipRoad.civic} Township Road ${ats.townshipRoad.number}`],
    ["Nearest Range Road", `~${ats.rangeRoad.civic} Range Road ${ats.rangeRoad.number}`],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
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
    ["State", address.state],
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

  const [atsSettled, osmSettled] = await Promise.allSettled([lookupATS(lat, lon), lookupOsm(lat, lon)]);

  resultEl.classList.remove("hidden");
  setStatus("", false);

  if (atsSettled.status === "fulfilled") {
    renderATS(atsSettled.value);
  } else {
    legalDescriptionEl.textContent = "Alberta Township System lookup failed: " + atsSettled.reason.message;
    atsCandidatesEl.innerHTML = "";
  }

  if (osmSettled.status === "fulfilled") {
    const data = osmSettled.value;
    if (data.error || !data.address) {
      osmAddressEl.textContent = "No OpenStreetMap address found for this location.";
      osmDetailsEl.innerHTML = "";
      fullNameEl.textContent = "";
    } else {
      osmAddressEl.textContent = buildOsmAddress(data.address) || "No specific road found near this point.";
      renderOsmDetails(data.address);
      fullNameEl.textContent = data.display_name || "";
    }
  } else {
    osmAddressEl.textContent = "OpenStreetMap lookup failed: " + osmSettled.reason.message;
    osmDetailsEl.innerHTML = "";
    fullNameEl.textContent = "";
  }

  submitBtn.disabled = false;
});
