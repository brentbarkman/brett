export interface AirQuality {
  aqi: number; // US EPA AQI (0-500+)
  category: string; // "Good", "Moderate", "Unhealthy for Sensitive Groups", etc.
  dominantPollutant?: string;
}

export interface WeatherCurrent {
  temp: number;
  feelsLike: number;
  conditionCode: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  icon: string;
  airQuality?: AirQuality;
}

export interface WeatherHourly {
  hour: string; // ISO timestamp
  temp: number;
  conditionCode: number;
  icon: string;
  precipProb: number;
}

export interface WeatherDaily {
  date: string; // YYYY-MM-DD
  high: number;
  low: number;
  conditionCode: number;
  icon: string;
  precipProb: number;
}

export interface WeatherData {
  current: WeatherCurrent;
  hourly: WeatherHourly[];
  daily: WeatherDaily[];
  city: string;
  fetchedAt: string; // ISO timestamp
  isStale: boolean;
  unit: "fahrenheit" | "celsius";
}

export interface GeocodingResult {
  name: string;
  state?: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  displayName: string; // "City, State, Country" formatted
}

export interface LocationSettings {
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  tempUnit: "auto" | "fahrenheit" | "celsius";
  weatherEnabled: boolean;
  backgroundStyle?: "photography" | "abstract" | "solid";
  pinnedBackground?: string | null;
}
