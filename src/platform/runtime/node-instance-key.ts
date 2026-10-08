/** F03 §5.1 canonical concrete node identity (BF-037). Browser-only; never part of the Blueprint body. */
export interface RepeatCoordinate {
  readonly repeat_node_id: string;
  readonly item_index: number;
}

export interface NodeInstanceKey {
  readonly node_id: string;
  /** Outermost → innermost multiplicative repeat ancestors; `[]` for singleton nodes. */
  readonly repeat_coordinates: readonly RepeatCoordinate[];
}

export function singletonKey(nodeId: string): NodeInstanceKey {
  return { node_id: nodeId, repeat_coordinates: [] };
}

/**
 * Map-key identity = exact node_id + ordered coordinates. Node ids follow `node_[a-z0-9_]+`, so `/` and `#`
 * cannot occur inside them and the encoding is injective.
 */
export function nodeInstanceKeyId(key: NodeInstanceKey): string {
  return key.repeat_coordinates.reduce(
    (id, coordinate) => `${id}/${coordinate.repeat_node_id}#${coordinate.item_index}`,
    key.node_id
  );
}

/** Inverse of the injective encoding above for the node_id component only. */
export function nodeIdOfKeyId(keyId: string): string {
  const separator = keyId.indexOf("/");
  return separator === -1 ? keyId : keyId.slice(0, separator);
}
