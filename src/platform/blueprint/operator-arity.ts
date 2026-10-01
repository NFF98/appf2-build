interface OperatorBounds {
  readonly min: number;
  readonly max: number | null;
}

const OPERATORS = new Map<string, OperatorBounds>([
  ["ADD", { min: 2, max: null }],
  ["SUB", { min: 2, max: 2 }],
  ["MUL", { min: 2, max: null }],
  ["DIV", { min: 2, max: 2 }],
  ["MOD", { min: 2, max: 2 }],
  ["ABS", { min: 1, max: 1 }],
  ["ROUND", { min: 1, max: 1 }],
  ["FLOOR", { min: 1, max: 1 }],
  ["CEIL", { min: 1, max: 1 }],
  ["MIN", { min: 1, max: null }],
  ["MAX", { min: 1, max: null }],
  ["EQ", { min: 2, max: 2 }],
  ["NEQ", { min: 2, max: 2 }],
  ["GT", { min: 2, max: 2 }],
  ["GTE", { min: 2, max: 2 }],
  ["LT", { min: 2, max: 2 }],
  ["LTE", { min: 2, max: 2 }],
  ["AND", { min: 2, max: null }],
  ["OR", { min: 2, max: null }],
  ["NOT", { min: 1, max: 1 }],
  ["IF", { min: 3, max: 3 }],
  ["COALESCE", { min: 2, max: null }],
  ["LENGTH", { min: 1, max: 1 }],
  ["SUM", { min: 1, max: 1 }],
  ["AVG", { min: 1, max: 1 }],
  ["COUNT", { min: 1, max: 1 }],
  ["LIST_MIN", { min: 1, max: 1 }],
  ["LIST_MAX", { min: 1, max: 1 }],
  ["CONCAT", { min: 2, max: null }],
  ["LOWER", { min: 1, max: 1 }],
  ["UPPER", { min: 1, max: 1 }],
  ["TRIM", { min: 1, max: 1 }]
]);

export function operatorArgCountAllowed(op: string, count: number): boolean | null {
  const bounds = OPERATORS.get(op);
  if (bounds === undefined) {
    return null;
  }
  if (count < bounds.min) {
    return false;
  }
  return bounds.max === null || count <= bounds.max;
}
