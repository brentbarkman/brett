import { describe, it, expect } from "vitest";
import { MockEmbeddingProvider, cosineSimilarity } from "../providers/mock-embedding.js";

describe("MockEmbeddingProvider", () => {
  const provider = new MockEmbeddingProvider();

  describe("basic properties", () => {
    it("returns vectors of correct dimensions (1024)", async () => {
      const vec = await provider.embed("hello world");
      expect(vec).toHaveLength(1024);
    });

    it("is deterministic — same input produces same output", async () => {
      const a = await provider.embed("budget review");
      const b = await provider.embed("budget review");
      expect(a).toEqual(b);
    });

    it("produces different vectors for different inputs", async () => {
      const a = await provider.embed("budget review");
      const b = await provider.embed("dentist appointment");
      expect(a).not.toEqual(b);
    });

    it("returns unit vectors (L2 norm ≈ 1)", async () => {
      const vec = await provider.embed("some random text");
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 2);
    });
  });

  describe("finance cluster", () => {
    const financeTexts = ["budget review", "Q3 financials", "revenue forecast"];

    it("pairwise similarity > 0.88", async () => {
      const vecs = await Promise.all(financeTexts.map((t) => provider.embed(t)));
      for (let i = 0; i < vecs.length; i++) {
        for (let j = i + 1; j < vecs.length; j++) {
          const sim = cosineSimilarity(vecs[i], vecs[j]);
          expect(sim).toBeGreaterThan(0.88);
        }
      }
    });
  });

  describe("hiring cluster", () => {
    const hiringTexts = ["engineering hiring", "interview pipeline", "recruiter sync"];

    it("pairwise similarity > 0.85", async () => {
      const vecs = await Promise.all(hiringTexts.map((t) => provider.embed(t)));
      for (let i = 0; i < vecs.length; i++) {
        for (let j = i + 1; j < vecs.length; j++) {
          const sim = cosineSimilarity(vecs[i], vecs[j]);
          expect(sim).toBeGreaterThan(0.85);
        }
      }
    });
  });

  describe("cross-cluster similarity (finance <-> hiring)", () => {
    it("similarity between 0.35-0.60", async () => {
      const financeVecs = await Promise.all(
        ["budget review", "Q3 financials", "revenue forecast"].map((t) => provider.embed(t)),
      );
      const hiringVecs = await Promise.all(
        ["engineering hiring", "interview pipeline", "recruiter sync"].map((t) => provider.embed(t)),
      );
      for (const fv of financeVecs) {
        for (const hv of hiringVecs) {
          const sim = cosineSimilarity(fv, hv);
          expect(sim).toBeGreaterThanOrEqual(0.35);
          expect(sim).toBeLessThanOrEqual(0.60);
        }
      }
    });
  });

  describe("outlier", () => {
    it('"dentist appointment" has similarity < 0.30 to all cluster members', async () => {
      const outlierVec = await provider.embed("dentist appointment");
      const clusterTexts = [
        "budget review",
        "Q3 financials",
        "revenue forecast",
        "engineering hiring",
        "interview pipeline",
        "recruiter sync",
      ];
      const clusterVecs = await Promise.all(clusterTexts.map((t) => provider.embed(t)));
      for (const cv of clusterVecs) {
        const sim = cosineSimilarity(outlierVec, cv);
        expect(sim).toBeLessThan(0.30);
      }
    });
  });

  describe("near-duplicate", () => {
    it('"Review Q3 budget" / "Q3 budget review" similarity > 0.96', async () => {
      const a = await provider.embed("Review Q3 budget");
      const b = await provider.embed("Q3 budget review");
      const sim = cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.96);
    });
  });

  describe("borderline pair", () => {
    it('"Prepare financial summary" / "Revenue dashboard update" similarity between 0.75-0.90', async () => {
      const a = await provider.embed("Prepare financial summary");
      const b = await provider.embed("Revenue dashboard update");
      const sim = cosineSimilarity(a, b);
      expect(sim).toBeGreaterThanOrEqual(0.75);
      expect(sim).toBeLessThanOrEqual(0.90);
    });
  });

  describe("embedBatch", () => {
    it("returns correct count and matches individual results", async () => {
      const texts = ["budget review", "engineering hiring", "dentist appointment"];
      const batchResults = await provider.embedBatch(texts);
      expect(batchResults).toHaveLength(3);

      const individualResults = await Promise.all(texts.map((t) => provider.embed(t)));
      for (let i = 0; i < texts.length; i++) {
        expect(batchResults[i]).toEqual(individualResults[i]);
      }
    });
  });

  describe("inputType param", () => {
    it("accepts inputType without error", async () => {
      await expect(provider.embed("test", "query")).resolves.toBeDefined();
      await expect(provider.embed("test", "document")).resolves.toBeDefined();
      await expect(provider.embedBatch(["test"], "query")).resolves.toBeDefined();
    });
  });
});
