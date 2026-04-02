import type { EmbeddingProvider } from "./types.js";

const DIMENSIONS = 1024;

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Simple deterministic hash → number in [0, 1).
 */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return ((hash >>> 0) % 10000) / 10000;
}

/**
 * Deterministic seeded PRNG (mulberry32).
 */
function mulberry32(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Convert a string to a deterministic integer seed.
 */
function textToSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------- Cluster definitions ----------

interface ClusterDef {
  name: string;
  subspaceStart: number; // start dim for this cluster's 64-dim subspace
  members: string[];
  nearDuplicateSets?: string[][]; // groups that should be near-duplicates
  borderlinePairs?: [string, string][]; // pairs with moderate similarity
}

const CLUSTERS: ClusterDef[] = [
  {
    name: "finance",
    subspaceStart: 0,
    members: [
      "budget review",
      "Q3 financials",
      "revenue forecast",
      "Review Q3 budget",
      "Q3 budget review",
      "Prepare financial summary",
      "Revenue dashboard update",
    ],
    nearDuplicateSets: [["Review Q3 budget", "Q3 budget review"]],
    borderlinePairs: [["Prepare financial summary", "Revenue dashboard update"]],
  },
  {
    name: "hiring",
    subspaceStart: 64,
    members: ["engineering hiring", "interview pipeline", "recruiter sync"],
  },
];

// Texts that belong to no cluster
const OUTLIER_SUBSPACE_START = 128;

/**
 * Normalize text for cluster matching: lowercase, trim.
 */
function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

/**
 * Find which cluster a text belongs to, if any.
 */
function findCluster(text: string): ClusterDef | null {
  const norm = normalizeText(text);
  for (const cluster of CLUSTERS) {
    for (const member of cluster.members) {
      if (normalizeText(member) === norm) return cluster;
    }
  }
  return null;
}

/**
 * Check if text is part of a near-duplicate set within its cluster.
 * Returns the set if found.
 */
function findNearDuplicateSet(text: string, cluster: ClusterDef): string[] | null {
  if (!cluster.nearDuplicateSets) return null;
  const norm = normalizeText(text);
  for (const ndSet of cluster.nearDuplicateSets) {
    if (ndSet.some((m) => normalizeText(m) === norm)) return ndSet;
  }
  return null;
}

/**
 * Check if text is part of a borderline pair within its cluster.
 */
function isBorderlineMember(text: string, cluster: ClusterDef): boolean {
  if (!cluster.borderlinePairs) return false;
  const norm = normalizeText(text);
  return cluster.borderlinePairs.some(([a, b]) => normalizeText(a) === norm || normalizeText(b) === norm);
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

/**
 * Generate a deterministic embedding vector for a given text.
 *
 * Strategy:
 * - Each cluster has a 64-dim subspace where cluster members get strong signal.
 * - Within a cluster, all members share a base "cluster seed" vector in that subspace,
 *   then each member adds a small perturbation.
 * - Near-duplicates share an even tighter sub-seed with very small perturbation.
 * - Borderline members get wider perturbation within the cluster subspace.
 * - Outliers get signal in a separate subspace with no overlap.
 * - All remaining dimensions get tiny noise for realism.
 */
function generateEmbedding(text: string): number[] {
  const vec = new Array<number>(DIMENSIONS).fill(0);
  const cluster = findCluster(text);

  // Shared "work" subspace (dims 192-255) — gives all cluster members baseline overlap
  const SHARED_SUBSPACE_START = 192;
  const SHARED_SUBSPACE_SIZE = 64;

  if (cluster) {
    const subStart = cluster.subspaceStart;

    // 1. Shared "work context" signal — same seed for all clusters
    const sharedRng = mulberry32(textToSeed("shared_work_context"));
    for (let i = 0; i < SHARED_SUBSPACE_SIZE; i++) {
      vec[SHARED_SUBSPACE_START + i] = (sharedRng() - 0.5) * 1.7;
    }

    // 2. Cluster-specific base seed
    const clusterRng = mulberry32(textToSeed(cluster.name + "_base"));
    for (let i = 0; i < 64; i++) {
      vec[subStart + i] = (clusterRng() - 0.5) * 2.0;
    }

    // 3. Per-member perturbation based on text role
    const ndSet = findNearDuplicateSet(text, cluster);
    const borderline = isBorderlineMember(text, cluster);

    if (ndSet) {
      // Near-duplicates: share a sub-seed, then tiny individual perturbation
      const subSeedRng = mulberry32(textToSeed(ndSet.sort().join("|")));
      for (let i = 0; i < 64; i++) {
        vec[subStart + i] += (subSeedRng() - 0.5) * 0.15;
      }
      const indRng = mulberry32(textToSeed(text));
      for (let i = 0; i < 64; i++) {
        vec[subStart + i] += (indRng() - 0.5) * 0.04;
      }
    } else if (borderline) {
      const indRng = mulberry32(textToSeed(text));
      for (let i = 0; i < 64; i++) {
        vec[subStart + i] += (indRng() - 0.5) * 0.90;
      }
    } else {
      const indRng = mulberry32(textToSeed(text));
      for (let i = 0; i < 64; i++) {
        vec[subStart + i] += (indRng() - 0.5) * 0.35;
      }
    }

    // 4. Tiny noise on remaining dimensions
    const noiseRng = mulberry32(textToSeed("noise_" + text));
    for (let i = 0; i < DIMENSIONS; i++) {
      if (i >= subStart && i < subStart + 64) continue;
      if (i >= SHARED_SUBSPACE_START && i < SHARED_SUBSPACE_START + SHARED_SUBSPACE_SIZE) continue;
      vec[i] += (noiseRng() - 0.5) * 0.08;
    }
  } else {
    // Outlier: signal in outlier subspace, NO shared work context
    const outlierRng = mulberry32(textToSeed(text));
    for (let i = 0; i < 64; i++) {
      vec[OUTLIER_SUBSPACE_START + i] = (outlierRng() - 0.5) * 2.0;
    }
    const noiseRng = mulberry32(textToSeed("noise_" + text));
    for (let i = 0; i < DIMENSIONS; i++) {
      if (i >= OUTLIER_SUBSPACE_START && i < OUTLIER_SUBSPACE_START + 64) continue;
      vec[i] += (noiseRng() - 0.5) * 0.08;
    }
  }

  return normalize(vec);
}

/**
 * Deterministic mock embedding provider for testing.
 *
 * Produces 1024-dim vectors with known semantic relationships:
 * - Finance cluster members are highly similar (>0.88)
 * - Hiring cluster members are highly similar (>0.85)
 * - Cross-cluster similarity is moderate (0.35-0.60)
 * - Outliers have low similarity (<0.30) to all clusters
 * - Near-duplicates are very similar (>0.96)
 * - Borderline pairs have moderate similarity (0.75-0.90)
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = DIMENSIONS;

  private cache = new Map<string, number[]>();

  async embed(text: string, _inputType?: "query" | "document"): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;
    const vec = generateEmbedding(text);
    this.cache.set(text, vec);
    return vec;
  }

  async embedBatch(texts: string[], _inputType?: "query" | "document"): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
