type ClassValue = string | number | null | undefined | false

/** Tiny `clsx`-style joiner -- not worth a dependency for one function. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
