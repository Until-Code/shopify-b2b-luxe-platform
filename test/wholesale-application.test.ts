import { describe, expect, it } from "vitest";
import { parseApplicationForm } from "../app/lib/b2b/wholesale-application";

function form(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    companyName: "  Basecamp Outfitters ",
    vatNumber: "fr 40 303265045",
    segment: "specialty_store",
    website: "",
    contactFirstName: "Camille",
    contactLastName: "Martin",
    email: "Camille@Basecamp-Outfitters.FR",
    phone: "",
    address1: "12 rue de la République",
    city: "Lyon",
    zip: "69002",
    countryCode: "fr",
    locale: "fr",
    message: "",
    acceptsTerms: "on",
    nickname: "",
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) data.set(key, value);
  return data;
}

describe("wholesale application form", () => {
  it("normalises a valid submission", () => {
    const result = parseApplicationForm(form());
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      companyName: "Basecamp Outfitters",
      vatNumber: "FR40303265045",
      email: "camille@basecamp-outfitters.fr",
      countryCode: "FR",
      website: null,
      phone: null,
      message: null,
    });
    expect(result.data).not.toHaveProperty("acceptsTerms");
    expect(result.data).not.toHaveProperty("nickname");
  });

  it.each([
    ["email", { email: "not-an-email" }],
    ["segment", { segment: "wholesaler" }],
    ["website", { website: "basecamp-outfitters.fr" }],
    ["vatNumber", { vatNumber: "123" }],
    ["countryCode", { countryCode: "FRA" }],
    ["acceptsTerms", { acceptsTerms: undefined }],
  ])("rejects an invalid %s", (field, overrides) => {
    const result = parseApplicationForm(form(overrides));
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toHaveProperty(field);
  });

  it("rejects bots that fill the honeypot", () => {
    const result = parseApplicationForm(form({ nickname: "buy-now" }));
    expect(result.success).toBe(false);
  });
});
