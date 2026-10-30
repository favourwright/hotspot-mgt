/**
 * An example value for any JSON Schema in the generated OpenAPI document,
 * built from the `examples` the schemas carry (lib/api-schemas.ts). This is
 * what fills the sample responses and payloads on /developers, so they are
 * generated rather than written, and show exactly the fields the API sends.
 *
 * Pure: takes the schema and the document's components, nothing else.
 */

type Schema = Record<string, unknown>;

export function exampleFor(schema: Schema, components: Record<string, Schema>, depth = 0): unknown {
  if (depth > 8) return null;
  const ref = schema.$ref;
  if (typeof ref === "string") {
    const target = components[ref.split("/").pop()!];
    return target ? exampleFor(target, components, depth + 1) : null;
  }
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if ("const" in schema) return schema.const;
  if ("default" in schema) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  const variants = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (Array.isArray(variants) && variants.length > 0) {
    const real = variants.find((v) => v.type !== "null") ?? variants[0];
    return exampleFor(real, components, depth + 1);
  }

  const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
  const type = types.find((t) => t !== "null") ?? types[0];
  switch (type) {
    case "object": {
      const props = (schema.properties as Record<string, Schema> | undefined) ?? {};
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, exampleFor(v, components, depth + 1)]));
    }
    case "array":
      return schema.items ? [exampleFor(schema.items as Schema, components, depth + 1)] : [];
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return true;
    case "string":
      return "string";
    default:
      return null;
  }
}
