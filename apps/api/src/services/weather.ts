import type {
  AirQuality,
  WeatherCurrent,
  WeatherHourly,
  WeatherDaily,
  GeocodingResult,
} from "@brett/types";

// ── Google Weather API ──
// https://developers.google.com/maps/documentation/weather

const GOOGLE_WEATHER_BASE = "https://weather.googleapis.com/v1";
const GOOGLE_AQI_BASE = "https://airquality.googleapis.com/v1";
const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";

function getGoogleWeatherApiKey(): string {
  const key = process.env.GOOGLE_WEATHER_API_KEY;
  if (!key) throw new Error("GOOGLE_WEATHER_API_KEY is not set");
  return key;
}

// ── Google Weather condition type → emoji mapping ──

const CONDITION_ICONS: Record<string, string> = {
  CLEAR: "☀️",
  MOSTLY_CLEAR: "🌤️",
  PARTLY_CLOUDY: "⛅",
  MOSTLY_CLOUDY: "☁️",
  CLOUDY: "☁️",
  FOG: "🌫️",
  LIGHT_FOG: "🌫️",
  HAZE: "🌫️",
  DUST: "🌫️",
  SMOKE: "🌫️",
  SAND: "🌫️",
  DRIZZLE: "🌦️",
  LIGHT_RAIN: "🌦️",
  FREEZING_DRIZZLE: "🌦️",
  RAIN: "🌧️",
  HEAVY_RAIN: "🌧️",
  FREEZING_RAIN: "🌧️",
  SNOW: "🌨️",
  LIGHT_SNOW: "🌨️",
  HEAVY_SNOW: "🌨️",
  BLOWING_SNOW: "🌨️",
  RAIN_AND_SNOW: "🌨️",
  SLEET: "🌨️",
  ICE_PELLETS: "🌨️",
  THUNDERSTORM: "⛈️",
  HAIL: "⛈️",
  TORNADO: "🌪️",
  TROPICAL_STORM: "🌪️",
  WINDY: "💨",
};

function resolveIcon(type: string): string {
  const icon = CONDITION_ICONS[type];
  if (!icon) {
    console.warn(`[weather] Unmapped condition type: ${type}`);
  }
  return icon ?? "☁️";
}

// ── Response types ──

interface GoogleTemp {
  degrees: number;
  unit: string;
}

interface GoogleWeatherCondition {
  iconBaseUri: string;
  description: { text: string };
  type: string;
}

interface GoogleWind {
  speed: { value: number; unit: string };
}

interface GooglePrecipitation {
  probability: { percent: number; type?: string };
}

interface GoogleCurrentConditions {
  temperature: GoogleTemp;
  feelsLikeTemperature: GoogleTemp;
  relativeHumidity: number;
  weatherCondition: GoogleWeatherCondition;
  wind: GoogleWind;
}

interface GoogleForecastHour {
  interval: { startTime: string };
  temperature: GoogleTemp;
  weatherCondition: GoogleWeatherCondition;
  precipitation: GooglePrecipitation;
}

interface GoogleForecastDay {
  displayDate: { year: number; month: number; day: number };
  maxTemperature: GoogleTemp;
  minTemperature: GoogleTemp;
  daytimeForecast: {
    weatherCondition: GoogleWeatherCondition;
    precipitation: GooglePrecipitation;
  };
}

// ── Google Air Quality API ──
// https://developers.google.com/maps/documentation/air-quality

interface GoogleAqiIndex {
  code: string;
  displayName: string;
  aqi: number;
  category: string;
  dominantPollutant: string;
}

interface GoogleAqiResponse {
  indexes?: GoogleAqiIndex[];
}

/** Fetch current AQI from Google Air Quality API. Returns null on failure (non-critical). */
async function fetchAirQuality(latitude: number, longitude: number, key: string): Promise<AirQuality | undefined> {
  try {
    const res = await fetch(`${GOOGLE_AQI_BASE}/currentConditions:lookup?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: { latitude, longitude },
        extraComputations: ["DOMINANT_POLLUTANT_CONCENTRATION"],
      }),
    });
    if (!res.ok) return undefined;

    const data: GoogleAqiResponse = await res.json();
    // Prefer US EPA index, fall back to Universal AQI
    const epa = data.indexes?.find((i) => i.code === "usa_epa");
    const index = epa ?? data.indexes?.[0];
    if (!index) return undefined;

    return {
      aqi: index.aqi,
      category: index.category,
      dominantPollutant: index.dominantPollutant,
    };
  } catch {
    return undefined;
  }
}

/** Fetch weather + AQI from Google APIs. All temperatures returned in Celsius — conversion happens at response time. */
export async function fetchForecast(
  latitude: number,
  longitude: number,
  _timezone: string,
): Promise<{ current: WeatherCurrent; hourly: WeatherHourly[]; daily: WeatherDaily[] }> {
  const key = getGoogleWeatherApiKey();
  const loc = `location.latitude=${latitude}&location.longitude=${longitude}`;

  // Fetch weather (current, hourly, daily) + AQI in parallel
  const [currentRes, hourlyRes, dailyRes, airQuality] = await Promise.all([
    fetch(`${GOOGLE_WEATHER_BASE}/currentConditions:lookup?key=${key}&${loc}`),
    fetch(`${GOOGLE_WEATHER_BASE}/forecast/hours:lookup?key=${key}&${loc}&hours=168`),
    fetch(`${GOOGLE_WEATHER_BASE}/forecast/days:lookup?key=${key}&${loc}&days=7&pageSize=7`),
    fetchAirQuality(latitude, longitude, key),
  ]);

  if (!currentRes.ok) {
    throw new Error(`Google Weather current conditions failed: ${currentRes.status} ${currentRes.statusText}`);
  }
  if (!hourlyRes.ok) {
    throw new Error(`Google Weather hourly forecast failed: ${hourlyRes.status} ${hourlyRes.statusText}`);
  }
  if (!dailyRes.ok) {
    throw new Error(`Google Weather daily forecast failed: ${dailyRes.status} ${dailyRes.statusText}`);
  }

  const currentData: GoogleCurrentConditions = await currentRes.json();
  const hourlyData: { forecastHours: GoogleForecastHour[] } = await hourlyRes.json();
  const dailyData: { forecastDays: GoogleForecastDay[] } = await dailyRes.json();

  const current: WeatherCurrent = {
    temp: currentData.temperature.degrees,
    feelsLike: currentData.feelsLikeTemperature.degrees,
    conditionCode: 0,
    condition: currentData.weatherCondition.description.text,
    humidity: currentData.relativeHumidity,
    windSpeed: currentData.wind.speed.value,
    icon: resolveIcon(currentData.weatherCondition.type),
    airQuality,
  };

  const hourly: WeatherHourly[] = (hourlyData.forecastHours ?? []).map((h) => ({
    hour: h.interval.startTime,
    temp: h.temperature.degrees,
    conditionCode: 0,
    icon: resolveIcon(h.weatherCondition.type),
    precipProb: h.precipitation?.probability?.percent ?? 0,
  }));

  const daily: WeatherDaily[] = (dailyData.forecastDays ?? []).map((d) => {
    const { year, month, day } = d.displayDate;
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return {
      date: dateStr,
      high: d.maxTemperature.degrees,
      low: d.minTemperature.degrees,
      conditionCode: 0,
      icon: resolveIcon(d.daytimeForecast.weatherCondition.type),
      precipProb: d.daytimeForecast.precipitation?.probability?.percent ?? 0,
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
