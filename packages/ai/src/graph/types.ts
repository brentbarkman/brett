export interface ExtractedEntity {
  type: "person" | "company" | "project" | "topic" | "tool" | "location";
  name: string;
  properties?: Record<string, string>;
}

export interface ExtractedRelationship {
  sourceType: string;
  sourceName: string;
  relationship: string;
  targetType: string;
  targetName: string;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

export const VALID_GRAPH_ENTITY_TYPES = new Set([
  "person",
  "company",
  "project",
  "topic",
  "tool",
  "location",
]);

export const VALID_RELATIONSHIP_TYPES = new Set([
  "works_at",
  "manages",
  "owns",
  "blocks",
  "related_to",
  "discussed_in",
  "produced_by",
  "reports_to",
  "collaborates_with",
  "uses",
  "part_of",
  "depends_on",
]);
