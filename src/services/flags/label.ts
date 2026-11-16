import type { FlagLite } from "@/services/marks";

/** A flag shown to the user: its path, system flags translated (`flag.<key>`). */
export function flagLabel(flag: FlagLite, flags: FlagLite[], t: (k: string) => string): string {
  const byId = new Map(flags.map((f) => [f.id, f]));
  const name = (f: FlagLite) => (f.isSystemDefault ? t(`flag.${f.name}`) : f.name);
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let f: FlagLite | undefined = flag; f && !seen.has(f.id); f = f.parentId ? byId.get(f.parentId) : undefined) {
    seen.add(f.id);
    parts.unshift(name(f));
  }
  return parts.join(" › ");
}
