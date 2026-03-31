import type { SearchProvider } from "./types.js";
import { TavilySearchProvider } from "./tavily.js";
import { ExaSearchProvider } from "./exa.js";

export type { SearchProvider, SearchOptions, SearchResult } from "./types.js";

const providers = new Map<string, SearchProvider>();

export function getSearchProvider(type: "web" | "entity"): SearchProvider {
  const cached = providers.get(type);
  if (cached) return cached;

  let provider: SearchProvider;

  switch (type) {
    case "web": {
      const key = process.env.TAVILY_API_KEY;
      if (!key) throw new Error("TAVILY_API_KEY is not configured");
      provider = new TavilySearchProvider(key);
      break;
    }
    case "entity": {
      const key = process.env.EXA_API_KEY;
      if (!key) throw new Error("EXA_API_KEY is not configured");
      provider = new ExaSearchProvider(key);
      break;
    }
    default:
      throw new Error(`Unknown search provider type: ${type}`);
  }

  providers.set(type, provider);
  return provider;
}

/** Determine provider type based on source domains */
export function classifySourceType(source: { name: string; url?: string }): "web" | "entity" {
  const entityDomains = ["linkedin.com", "crunchbase.com"];
  const entityKeywords = ["linkedin", "crunchbase"];

  const url = (source.url ?? "").toLowerCase();
  const name = source.name.toLowerCase();

  // URL takes priority over name keywords
  for (const domain of entityDomains) {
    if (url.includes(domain)) return "entity";
  }
  for (const kw of entityKeywords) {
    if (name.includes(kw) && !url) return "entity";
  }

  return "web";
}
