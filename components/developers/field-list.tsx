import { inline } from "@/components/developers/doc-text";
import type { Field } from "@/lib/docs-view";

/**
 * Fields the way the reference designs show them: the name in the brand
 * colour, a type chip, whether it is required or can be null, what it
 * means, and an example value.
 */
export function FieldList({ fields, showRequired = false }: { fields: Field[]; showRequired?: boolean }) {
  if (fields.length === 0) return <p className="text-sm text-muted-foreground">No fields.</p>;
  return (
    <div className="divide-y divide-border/60">
      {fields.map((f) => (
        <div key={f.name} className="space-y-1.5 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm font-semibold text-primary">{f.name}</code>
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{f.type}</span>
            {showRequired && f.required && <span className="text-xs font-medium text-destructive">required</span>}
            {f.nullable && <span className="text-xs text-muted-foreground">nullable</span>}
          </div>
          {f.description && <p className="text-sm text-muted-foreground">{inline(f.description)}</p>}
          {f.example !== null && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Example:
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-foreground">{f.example}</code>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
