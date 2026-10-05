import { z } from "zod";

export const SEGMENTS = [
  "specialty_store",
  "sporting_goods_chain",
  "online_retailer",
  "rental_guiding",
  "distributor",
] as const;

export const APPLICATION_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

/** Validates the storefront form posted through the app proxy. */
export const wholesaleApplicationSchema = z
  .object({
    companyName: z.string().trim().min(2).max(120),
    vatNumber: optionalText(20).refine(
      (v) => v === null || /^[A-Z]{2}[A-Z0-9]{2,18}$/.test(v.replace(/\s/g, "").toUpperCase()),
      "Invalid VAT / tax number",
    ),
    segment: z.enum(SEGMENTS),
    website: optionalText(200).refine(
      (v) => v === null || /^https?:\/\/[^\s]+\.[^\s]+$/.test(v),
      "Website must start with http(s)://",
    ),
    contactFirstName: z.string().trim().min(1).max(60),
    contactLastName: z.string().trim().min(1).max(60),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: optionalText(30),
    address1: z.string().trim().min(3).max(200),
    city: z.string().trim().min(1).max(100),
    zip: z.string().trim().min(2).max(20),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((v) => v.toUpperCase()),
    locale: z.enum(["en", "fr"]).default("en"),
    message: optionalText(2000),
    acceptsTerms: z.literal("on", { errorMap: () => ({ message: "Terms must be accepted" }) }),
    // Honeypot: hidden field that humans never fill.
    nickname: z.string().max(0, "Spam detected").optional(),
  })
  .transform(({ acceptsTerms: _terms, nickname: _honeypot, vatNumber, ...data }) => ({
    ...data,
    vatNumber: vatNumber ? vatNumber.replace(/\s/g, "").toUpperCase() : null,
  }));

export type WholesaleApplicationInput = z.infer<typeof wholesaleApplicationSchema>;

export function parseApplicationForm(form: FormData) {
  return wholesaleApplicationSchema.safeParse(Object.fromEntries(form));
}
