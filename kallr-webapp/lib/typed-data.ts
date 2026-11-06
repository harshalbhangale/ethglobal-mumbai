/** Flash sends EIP-712 typed data as JSON, with numbers as strings; viem signs with bigints. */

type Field = { name: string; type: string };
type TypedJson = { domain: Record<string, unknown>; types: Record<string, Field[]>; primaryType: string; message: Record<string, unknown> };

function convert(value: unknown, type: string, types: Record<string, Field[]>): unknown {
  const array = type.match(/^(.*)\[\d*\]$/);
  if (array) return (value as unknown[]).map((v) => convert(v, array[1], types));
  const struct = types[type];
  if (struct) {
    const out: Record<string, unknown> = {};
    for (const f of struct) out[f.name] = convert((value as Record<string, unknown>)[f.name], f.type, types);
    return out;
  }
  if (/^u?int\d*$/.test(type)) return BigInt(value as string | number);
  return value;
}

export function parseTypedData(json: string) {
  const t = JSON.parse(json) as TypedJson;
  const { EIP712Domain: _domain, ...types } = t.types;
  const domain = { ...t.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  return { domain, types, primaryType: t.primaryType, message: convert(t.message, t.primaryType, types) as Record<string, unknown> };
}
