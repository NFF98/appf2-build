import type { JsonValue } from "../../platform/intent/json-value.js";
import { recordEntries, scalarText } from "./value-display.js";

/** Read-only, structure-preserving display of a value F01 presented; composites are never flattened to JSON. */
export function ValueView({ value }: { readonly value: JsonValue | undefined }) {
  if (value === undefined) return <span className="value-empty">—</span>;
  if (Array.isArray(value)) {
    const items = value as readonly JsonValue[];
    if (items.length === 0) return <span className="value-empty">（無）</span>;
    return (
      <ul className="value-list">
        {items.map((item, index) => (
          <li key={index}>
            <ValueView value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (value !== null && typeof value === "object") {
    const entries = recordEntries(value);
    if (entries.length === 0) return <span className="value-empty">（無欄位）</span>;
    return (
      <dl className="value-record">
        {entries.map(([key, entry]) => (
          <div key={key} className="value-record-row">
            <dt>{key}</dt>
            <dd>
              <ValueView value={entry} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="value-scalar">{scalarText(value as string | number | boolean | null)}</span>;
}
