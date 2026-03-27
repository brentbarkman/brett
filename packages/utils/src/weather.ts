const FAHRENHEIT_COUNTRIES = new Set(["US", "LR", "MM"]);

export function resolveTempUnit(
  tempUnit: string,
  countryCode?: string,
): "fahrenheit" | "celsius" {
  if (tempUnit === "fahrenheit") return "fahrenheit";
  if (tempUnit === "celsius") return "celsius";
  return countryCode && FAHRENHEIT_COUNTRIES.has(countryCode) ? "fahrenheit" : "celsius";
}

/** Convert Celsius to the target unit. All cached temps are stored as Celsius. */
export function convertTemp(celsius: number, unit: "fahrenheit" | "celsius"): number {
  if (unit === "fahrenheit") return Math.round((celsius * 9) / 5 + 32);
  return celsius;
}
