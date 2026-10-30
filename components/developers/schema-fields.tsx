import { inline } from "@/components/developers/doc-text";

type Schema = Record<string, unknown>;

/**
 * A JSON Schema object as a table of fields, resolving references to the
 * document's components. What a developer needs from a schema at a glance:
 * each field's name, type, whether it can be null, and what it means.
 */
export function SchemaFields({ schema, components }: { schema: Schema; components: Record<string, Schema> }) {
  const resolved = resolve(schema, components);
  const props = (resolved.properties as Record<string, Schema> | undefined) ?? {};
  const entries = Object.entries(props);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{typeLabel(schema, components)}</p>;
  }
  return (
    <div className="divide-y divide-border/60 rounded-2xl border border-border/60">
      {entries.map(([name, field]) => (
        <div key={name} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr] sm:gap-4">
          <div className="min-w-0">
            <code className="font-mono text-xs font-medium text-foreground">{name}</code>
            <div className="text-xs text-muted-foreground">{typeLabel(field, components)}</div>
          </div>
          <div className="text-sm text-muted-foreground">
            {typeof field.description === "string" ? inline(field.description) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function resolve(schema: Schema, components: Record<string, Schema>): Schema {
  const ref = schema.$ref;
  if (typeof ref === "string" && ref.startsWith("#/components/schemas/")) {
    return components[ref.split("/").pop()!] ?? schema;
  }
  return schema;
}

export function refName(schema: Schema): string | null {
  const ref = schema.$ref;
  return typeof ref === "string" ? ref.split("/").pop()! : null;
}

/** "string", "integer or null", "list of Voucher", "one of active, expired". */
export function typeLabel(schema: Schema, components: Record<string, Schema>): string {
  const name = refName(schema);
  if (name) return name;
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map((v) => String(v)).join(", ")}`;
  const variants = (schema.anyOf ?? schema.oneOf) as Schema[] | undefined;
  if (Array.isArray(variants)) return variants.map((v) => typeLabel(v, components)).join(" or ");
  const types = Array.isArray(schema.type) ? (schema.type as string[]) : schema.type ? [schema.type as string] : [];
  const nullable = types.includes("null");
  const base = types.filter((t) => t !== "null");
  let label = base.join(" or ") || "any";
  if (base[0] === "array" && schema.items) label = `list of ${typeLabel(schema.items as Schema, components)}`;
  const range =
    typeof schema.minimum === "number" && typeof schema.maximum === "number" ? `, ${schema.minimum} to ${schema.maximum}` : "";
  const fallback = "default" in schema ? `, default ${JSON.stringify(schema.default)}` : "";
  return `${label}${range}${fallback}${nullable ? " or null" : ""}`;
}
