import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true });

export function validateSkillArgs(
  schema: Record<string, unknown>,
  args: unknown
): { valid: true } | { valid: false; errors: string } {
  const validate = ajv.compile(schema);
  const valid = validate(args);
  if (!valid) {
    return { valid: false, errors: ajv.errorsText(validate.errors) };
  }
  return { valid: true };
}
