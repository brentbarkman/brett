import type {
  WeatherCurrent,
  WeatherHourly,
  WeatherDaily,
  GeocodingResult,
} from "@brett/types";

// ── WMO Weather Code Mapping ──

const WMO_CODES: Record<number, { condition: string; icon: string }> = {
  0: { condition: "Clear sky", icon: "\u2600\uFE0F" },
  1: { condition: "Mainly clear", icon: "\uD83C\uDF24\uFE0F" },
  2: { condition: "Partly cloudy", icon: "\u26C5" },
  3: { condition: "Overcast", icon: "\u2601\uFE0F" },
  45: { condition: "Fog", icon: "\uD83C\uDF2B\uFE0F" },
  48: { condition: "Rime fog", icon: "\uD83C\uDF2B\uFE0F" },
  51: { condition: "Light drizzle", icon: "\uD83C\uDF26\uFE0F" },
  53: { condition: "Moderate drizzle", icon: "\uD83C\uDF26\uFE0F" },
  55: { condition: "Dense drizzle", icon: "\uD83C\uDF26\uFE0F" },
  56: { condition: "Light freezing drizzle", icon: "\uD83C\uDF27\uFE0F" },
  57: { condition: "Dense freezing drizzle", icon: "\uD83C\uDF27\uFE0F" },
  61: { condition: "Slight rain", icon: "\uD83C\uDF27\uFE0F" },
  63: { condition: "Moderate rain", icon: "\uD83C\uDF27\uFE0F" },
  65: { condition: "Heavy rain", icon: "\uD83C\uDF27\uFE0F" },
  66: { condition: "Light freezing rain", icon: "\uD83C\uDF27\uFE0F" },
  67: { condition: "Heavy freezing rain", icon: "\uD83C\uDF27\uFE0F" },
  71: { condition: "Slight snow", icon: "\uD83C\uDF28\uFE0F" },
  73: { condition: "Moderate snow", icon: "\uD83C\uDF28\uFE0F" },
  75: { condition: "Heavy snow", icon: "\uD83C\uDF28\uFE0F" },
  77: { condition: "Snow grains", icon: "\uD83C\uDF28\uFE0F" },
  80: { condition: "Slight showers", icon: "\uD83C\uDF26\uFE0F" },
  81: { condition: "Moderate showers", icon: "\uD83C\uDF27\uFE0F" },
  82: { condition: "Violent showers", icon: "\uD83C\uDF27\uFE0F" },
  85: { condition: "Slight snow showers", icon: "\uD83C\uDF28\uFE0F" },
  86: { condition: "Heavy snow showers", icon: "\uD83C\uDF28\uFE0F" },
  95: { condition: "Thunderstorm", icon: "\u26C8\uFE0F" },
  96: { condition: "Thunderstorm with hail", icon: "\u26C8\uFE0F" },
  99: { condition: "Thunderstorm with heavy hail", icon: "\u26C8\uFE0F" },
};

function resolveWmo(code: number): { condition: string; icon: string } {
  return WMO_CODES[code] ?? { condition: "Unknown", icon: "\u2753" };
}

// ── Open-Meteo Forecast API ──

const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const IP_API_BASE = "http://ip-api.com/json";

interface ForecastResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    weather_code: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    precipitation_probability: number[];
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
    precipitation_probability_max: number[];
  };
}

export async function fetchForecast(
  latitude: number,
  longitude: number,
  timezone: string,
): Promise<{ current: WeatherCurrent; hourly: WeatherHourly[]; daily: WeatherDaily[] }> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    current:
      "temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m",
    hourly: "temperature_2m,weather_code,precipitation_probability",
    daily:
      "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max",
    forecast_days: "7",
  });

  const res = await fetch(`${FORECAST_BASE}?${params}`);
  if (!res.ok) {
    throw new Error(`Open-Meteo forecast failed: ${res.status} ${res.statusText}`);
  }

  const data: ForecastResponse = await res.json();

  const currentWmo = resolveWmo(data.current.weather_code);
  const current: WeatherCurrent = {
    temp: data.current.temperature_2m,
    feelsLike: data.current.apparent_temperature,
    conditionCode: data.current.weather_code,
    condition: currentWmo.condition,
    humidity: data.current.relative_humidity_2m,
    windSpeed: data.current.wind_speed_10m,
    icon: currentWmo.icon,
  };

  const hourly: WeatherHourly[] = data.hourly.time.map((time, i) => {
    const wmo = resolveWmo(data.hourly.weather_code[i]);
    return {
      hour: time,
      temp: data.hourly.temperature_2m[i],
      conditionCode: data.hourly.weather_code[i],
      icon: wmo.icon,
      precipProb: data.hourly.precipitation_probability[i],
    };
  });

  const daily: WeatherDaily[] = data.daily.time.map((time, i) => {
    const wmo = resolveWmo(data.daily.weather_code[i]);
    return {
      date: time,
      high: data.daily.temperature_2m_max[i],
      low: data.daily.temperature_2m_min[i],
      conditionCode: data.daily.weather_code[i],
      icon: wmo.icon,
      precipProb: data.daily.precipitation_probability_max[i],
    };
  });

  return { current, hourly, daily };
}

// ── Open-Meteo Geocoding API ──

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

// ── IP Geolocation (ip-api.com) ──

interface IpApiResponse {
  status: string;
  city: string;
  regionName: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  timezone: string;
}

export async function geolocateIp(ip: string): Promise<GeocodingResult | null> {
  try {
    const res = await fetch(
      `${IP_API_BASE}/${ip}?fields=status,city,regionName,country,countryCode,lat,lon,timezone`,
    );
    if (!res.ok) return null;

    const data: IpApiResponse = await res.json();
    if (data.status !== "success") return null;

    return {
      name: data.city,
      state: data.regionName,
      country: data.country,
      countryCode: data.countryCode,
      latitude: data.lat,
      longitude: data.lon,
      timezone: data.timezone,
      displayName: formatDisplayName(data.city, data.regionName, data.country),
    };
  } catch {
    return null;
  }
}
