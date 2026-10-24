// NIPOST digital postcode: 5 segments, 11 characters.
//   AA 99 H77 BB 55  ->  state(2 letters) lga(01-99) district(3 alnum) area(2 letters) unit(01-99)
export const POSTCODE_LENGTH = 11;

const COMPACT_RE = /^[A-Z]{2}(0[1-9]|[1-9][0-9])[A-Z0-9]{3}[A-Z]{2}(0[1-9]|[1-9][0-9])$/;

/** Strip everything except letters/digits, uppercase, cap at 11 characters. */
export function toCompact(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, POSTCODE_LENGTH);
}

/** "AA99H77BB55" -> "AA 99 H77 BB 55" (works on partial input too). */
export function formatPostcode(compact: string): string {
  return [
    compact.slice(0, 2),
    compact.slice(2, 4),
    compact.slice(4, 7),
    compact.slice(7, 9),
    compact.slice(9, 11),
  ]
    .filter(Boolean)
    .join(" ");
}

export function isValidPostcode(compact: string): boolean {
  return COMPACT_RE.test(compact);
}

export function normalizePostcode(
  input: string
): { compact: string; canonical: string; display: string } | null {
  const compact = input.replace(/[\s-]+/g, "").toUpperCase();
  if (!isValidPostcode(compact)) return null;
  return {
    compact,
    canonical: formatPostcode(compact).replace(/ /g, "-"),
    display: formatPostcode(compact),
  };
}
