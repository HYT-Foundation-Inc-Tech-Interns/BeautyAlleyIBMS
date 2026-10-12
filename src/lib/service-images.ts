import type { Service, ServiceCategory } from "@/lib/api-types";

/**
 * Service imagery.
 *
 * The catalogue is data, not code — services are rows the salon edits through
 * the console — so a service's picture is *resolved* from its name first and
 * its category second, rather than being stored per row. That keeps the cards
 * illustrated without a schema change, and a service the salon adds later gets
 * a sensible picture the moment it is created.
 *
 * The files live in `public/assets`, so they are served from `/assets/…` and
 * need no bundler import.
 */

const BASE = "/assets";

/** Name keyword → file, checked in order against the lower-cased service name. */
const BY_KEYWORD: { match: RegExp; file: string }[] = [
  { match: /(hot stone|stone|bato)/, file: "bato.jpg" },
  { match: /(massage|deep tissue|shiatsu|relax)/, file: "massage.jpg" },
  { match: /(facial|face|skin|glow|bright|peel)/, file: "oilface.jpg" },
  { match: /(mask|cleanse|oilface)/, file: "white.jpg" },
  { match: /(nail|manicure|pedicure|hand|feet|foot)/, file: "nail.jpg" },
  { match: /(perm|curl|wave|styl|blow ?dry|cut|trim|updo|hairdo)/, file: "perm.jpg" },
  { match: /(color|colour|dye|highlight|balayage|tint|bleach|foil)/, file: "color.jpg" },
  { match: /(treat|hair)/, file: "haircolor.jpg" },
];

/** Category → file, used when the name gives nothing away. */
const BY_CATEGORY: Record<ServiceCategory, string> = {
  SPA: "massage.jpg",
  SALON: "haircolor.jpg",
  WELLNESS: "white.jpg",
};

/** The `/assets/…` URL for a service's picture. */
export function serviceImage(service: Pick<Service, "name" | "category">): string {
  const name = service.name.toLowerCase();
  const hit = BY_KEYWORD.find((k) => k.match.test(name));
  return `${BASE}/${hit ? hit.file : BY_CATEGORY[service.category]}`;
}
