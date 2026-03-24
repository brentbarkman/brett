import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true });

export function validateSkillArgs(
  schema: Record<string, unknown>,
  args: unknown
): { valid: true } | { valid: false; errors: string } {
  const validate = ajv.compile(schema);
  const valid = validate(args);
  if (!valid) {
    // Return a generic message to the LLM — don't expose full schema structure.
    // Extract just the field names that failed, not the full AJV error details.
    const fields = (validate.errors || [])
      .map((e) => e.instancePath?.replace(/^\//, "") || e.params?.missingProperty || "unknown")
      .filter(Boolean);
    const fieldList = [...new Set(fields)].join(", ");
    return { valid: false, errors: fieldList ? `Invalid fields: ${fieldList}` : "Invalid arguments" };
  }
  return { valid: true };
}
