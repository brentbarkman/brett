import type {
  WeatherCurrent,
  WeatherHourly,
  WeatherDaily,
  GeocodingResult,
} from "@brett/types";

// ── OpenWeatherMap Condition Code → Emoji Mapping ──
// https://openweathermap.org/weather-conditions

function resolveOwmIcon(id: number): string {
  if (id >= 200 && id < 300) return "\u26C8\uFE0F"; // Thunderstorm
  if (id >= 300 && id < 400) return "\uD83C\uDF26\uFE0F"; // Drizzle
  if (id >= 500 && id < 600) return "\uD83C\uDF27\uFE0F"; // Rain
  if (id >= 600 && id < 700) return "\uD83C\uDF28\uFE0F"; // Snow
  if (id >= 700 && id < 800) return "\uD83C\uDF2B\uFE0F"; // Atmosphere (fog, haze, etc.)
  if (id === 800) return "\u2600\uFE0F"; // Clear
  if (id === 801) return "\uD83C\uDF24\uFE0F"; // Few clouds
  if (id === 802) return "\u26C5"; // Scattered clouds
  if (id >= 803) return "\u2601\uFE0F"; // Broken/overcast clouds
  return "\u2753"; // Unknown
}

// ── OpenWeatherMap One Call 3.0 API ──

const OWM_BASE = "https://api.openweathermap.org/data/3.0/onecall";
const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";

function getOwmApiKey(): string {
  const key = process.env.OPENWEATHERMAP_API_KEY;
  if (!key) throw new Error("OPENWEATHERMAP_API_KEY is not set");
  return key;
}

interface OwmCurrentResponse {
  dt: number;
  temp: number;
  feels_like: number;
  humidity: number;
  wind_speed: number;
  weather: Array<{ id: number; description: string }>;
}

interface OwmHourlyResponse {
  dt: number;
  temp: number;
  pop: number; // probability of precipitation (0-1)
  weather: Array<{ id: number; description: string }>;
}

interface OwmDailyResponse {
  dt: number;
  temp: { min: number; max: number };
  pop: number;
  weather: Array<{ id: number; description: string }>;
}

interface OwmOnecallResponse {
  current: OwmCurrentResponse;
  hourly: OwmHourlyResponse[];
  daily: OwmDailyResponse[];
}

/** Fetch 8-day forecast from OpenWeatherMap One Call 3.0. All temperatures returned in Celsius — conversion happens at response time. */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  _timezone: string,
): Promise<{ current: WeatherCurrent; hourly: WeatherHourly[]; daily: WeatherDaily[] }> {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    appid: getOwmApiKey(),
    units: "metric",
    exclude: "minutely,alerts",
  });

  const res = await fetch(`${OWM_BASE}?${params}`);
  if (!res.ok) {
    throw new Error(`OpenWeatherMap forecast failed: ${res.status} ${res.statusText}`);
  }

  const data: OwmOnecallResponse = await res.json();

  const currentWeather = data.current.weather[0];
  const current: WeatherCurrent = {
    temp: data.current.temp,
    feelsLike: data.current.feels_like,
    conditionCode: currentWeather?.id ?? 0,
    condition: currentWeather?.description ?? "Unknown",
    humidity: data.current.humidity,
    windSpeed: data.current.wind_speed,
    icon: resolveOwmIcon(currentWeather?.id ?? 0),
  };

  // OWM returns 48 hours of hourly data
  const hourly: WeatherHourly[] = data.hourly.map((h) => {
    const w = h.weather[0];
    return {
      hour: new Date(h.dt * 1000).toISOString(),
      temp: h.temp,
      conditionCode: w?.id ?? 0,
      icon: resolveOwmIcon(w?.id ?? 0),
      precipProb: Math.round(h.pop * 100),
    };
  });

  // OWM returns 8 days of daily data — trim to 7 for consistency
  const daily: WeatherDaily[] = data.daily.slice(0, 7).map((d) => {
    const w = d.weather[0];
    const date = new Date(d.dt * 1000);
    return {
      date: date.toISOString().split("T")[0],
      high: d.temp.max,
      low: d.temp.min,
      conditionCode: w?.id ?? 0,
      icon: resolveOwmIcon(w?.id ?? 0),
      precipProb: Math.round(d.pop * 100),
    };
  });

  return { current, hourly, daily };
}

// ── Open-Meteo Geocoding API (kept — free, no key required) ──

interface GeocodingApiResult {
  name: string;
  admin1?: string;
  country: string;
  country_code: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

interface GeocodingApiResponse {
  results?: GeocodingApiResult[];
}

function formatDisplayName(name: string, state?: string, country?: string): string {
  const parts = [name];
  if (state) parts.push(state);
  if (country) parts.push(country);
  return parts.join(", ");
}

export async function searchCities(query: string): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({
    name: query,
    count: "8",
    language: "en",
  });

  const res = await fetch(`${GEOCODING_BASE}?${params}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo geocoding failed: ${res.status} ${res.statusText}`);
  }

  const data: GeocodingApiResponse = await res.json();
  if (!data.results) return [];

  return data.results.map((r) => ({
    name: r.name,
    state: r.admin1,
    country: r.country,
    countryCode: r.country_code,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    displayName: formatDisplayName(r.name, r.admin1, r.country),
  }));
}

// ── IP Geolocation (ipapi.co — HTTPS) ──

function isPublicIp(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 0 || a >= 224) return false;
  return true;
}

export async function geolocateIp(ip: string): Promise<GeocodingResult | null> {
  if (!isPublicIp(ip)) return null;
  try {
    const res = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    return {
      name: data.city ?? "",
      state: data.region ?? "",
      country: data.country_name ?? "",
      countryCode: data.country_code ?? "",
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone ?? "",
      displayName: [data.city, data.region, data.country_name].filter(Boolean).join(", "),
    };
  } catch {
    return null;
  }
}
