const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

const form = document.getElementById("lookup-form");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const ruralAddressEl = document.getElementById("rural-address");
const detailsEl = document.getElementById("details");
const fullNameEl = document.getElementById("full-name");

function setStatus(message, isError) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

function parseCoordinate(value, min, max) {
  const num = Number(value.trim());
  if (Number.isNaN(num) || num < min || num > max) {
    return null;
  }
  return num;
}

function buildRuralAddress(address) {
  const road = address.road;
  if (!road) {
    return null;
  }
  return address.house_number ? `${address.house_number} ${road}` : road;
}

function renderDetails(address) {
  detailsEl.innerHTML = "";
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
    detailsEl.append(dt, dd);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const lat = parseCoordinate(document.getElementById("lat").value, -90, 90);
  const lon = parseCoordinate(document.getElementById("lon").value, -180, 180);

  if (lat === null || lon === null) {
    setStatus("Please enter a valid latitude (-90 to 90) and longitude (-180 to 180).", true);
    resultEl.classList.add("hidden");
    return;
  }

  submitBtn.disabled = true;
  resultEl.classList.add("hidden");
  setStatus("Looking up address...", false);

  const url = new URL(NOMINATIM_REVERSE_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Lookup failed (HTTP ${response.status}).`);
    }

    const data = await response.json();

    if (data.error || !data.address) {
      setStatus("No address found for that location.", true);
      return;
    }

    const ruralAddress = buildRuralAddress(data.address);

    setStatus("", false);
    resultEl.classList.remove("hidden");
    ruralAddressEl.textContent = ruralAddress || "No specific road found near this point.";
    renderDetails(data.address);
    fullNameEl.textContent = data.display_name || "";
  } catch (err) {
    setStatus(err.message || "Something went wrong looking up that location.", true);
  } finally {
    submitBtn.disabled = false;
  }
});
