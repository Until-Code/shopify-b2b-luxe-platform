import { describe, expect, it, vi } from "vitest";
import {
  buildCompanyCreateInput,
  externalCompanyId,
  onboardCompany,
  type ApplicationForOnboarding,
} from "../app/lib/b2b/company-onboarding";
import { fakeAdmin } from "./helpers";

const application: ApplicationForOnboarding = {
  id: "clx0000000000basecamplyon",
  companyName: "Basecamp Outfitters",
  vatNumber: "FR40303265045",
  segment: "specialty_store",
  website: "https://basecamp-outfitters.fr",
  contactFirstName: "Camille",
  contactLastName: "Martin",
  email: "Camille@Basecamp-Outfitters.fr",
  phone: null,
  address1: "12 rue de la République",
  city: "Lyon",
  zip: "69002",
  countryCode: "fr",
  locale: "fr",
  shopifyCompanyId: null,
};

const decision = {
  catalogId: "gid://shopify/CompanyLocationCatalog/9",
  paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/4",
  authorizedBrands: ["Northpeak"],
  minimumOrderAmount: "1500",
};

describe("buildCompanyCreateInput", () => {
  it("maps an application to a company, contact and location", () => {
    const input = buildCompanyCreateInput(application, decision);

    expect(input.company.externalId).toBe("B2B-FR-CAMPLYON");
    expect(input.companyContact).toEqual({
      firstName: "Camille",
      lastName: "Martin",
      email: "camille@basecamp-outfitters.fr",
      locale: "fr",
    });
    expect(input.companyLocation).toMatchObject({
      name: "Basecamp Outfitters — Lyon",
      taxRegistrationId: "FR40303265045",
      billingSameAsShipping: true,
      shippingAddress: { countryCode: "FR", city: "Lyon", zip: "69002" },
      buyerExperienceConfiguration: {
        checkoutToDraft: false,
        editableShippingAddress: false,
        paymentTermsTemplateId: "gid://shopify/PaymentTermsTemplate/4",
      },
    });
  });

  it("omits optional values", () => {
    const input = buildCompanyCreateInput({ ...application, vatNumber: null }, { paymentTermsTemplateId: null });
    expect(input.companyLocation).not.toHaveProperty("taxRegistrationId");
    expect(input.companyLocation.buyerExperienceConfiguration).not.toHaveProperty("paymentTermsTemplateId");
  });

  it("derives a stable external id", () => {
    expect(externalCompanyId(application)).toBe("B2B-FR-CAMPLYON");
  });
});

function shopify({ assigned = false } = {}) {
  return fakeAdmin({
    CompanyCreate: () => ({
      data: { companyCreate: { company: { id: "gid://shopify/Company/1" }, userErrors: [] } },
    }),
    CompanyStructure: () => ({
      data: {
        company: {
          id: "gid://shopify/Company/1",
          mainContact: { id: "gid://shopify/CompanyContact/1" },
          contactRoles: {
            nodes: [
              { id: "gid://shopify/CompanyContactRole/1", name: "Location admin" },
              { id: "gid://shopify/CompanyContactRole/2", name: "Ordering only" },
            ],
          },
          locations: {
            nodes: [
              {
                id: "gid://shopify/CompanyLocation/1",
                roleAssignments: {
                  nodes: assigned ? [{ companyContact: { id: "gid://shopify/CompanyContact/1" } }] : [],
                },
              },
            ],
          },
        },
      },
    }),
    CompanyContactAssignRole: () => ({
      data: { companyContactAssignRole: { companyContactRoleAssignment: { id: "x" }, userErrors: [] } },
    }),
    CatalogContextUpdate: () => ({ data: { catalogContextUpdate: { catalog: { id: "c" }, userErrors: [] } } }),
    B2bMetafieldsSet: () => ({ data: { metafieldsSet: { metafields: [], userErrors: [] } } }),
  });
}

describe("onboardCompany", () => {
  it("creates the company, assigns the ordering role, catalog and B2B rules", async () => {
    const admin = shopify();
    const onCompanyCreated = vi.fn(async () => {});

    const result = await onboardCompany({ gateway: admin.gateway, application, decision, onCompanyCreated });

    expect(result).toEqual({
      companyId: "gid://shopify/Company/1",
      locationId: "gid://shopify/CompanyLocation/1",
    });
    expect(onCompanyCreated).toHaveBeenCalledWith("gid://shopify/Company/1");
    expect(admin.ops("CompanyContactAssignRole")[0].variables).toMatchObject({
      roleId: "gid://shopify/CompanyContactRole/2",
    });
    expect(admin.ops("B2bMetafieldsSet")[0].variables).toEqual({
      metafields: [
        {
          ownerId: "gid://shopify/Company/1",
          namespace: "b2b",
          key: "authorized_brands",
          type: "list.single_line_text_field",
          value: '["Northpeak"]',
        },
        {
          ownerId: "gid://shopify/CompanyLocation/1",
          namespace: "b2b",
          key: "minimum_order_amount",
          type: "number_decimal",
          value: "1500",
        },
      ],
    });
  });

  it("resumes a partially completed onboarding without duplicating the company", async () => {
    const admin = shopify({ assigned: true });
    await onboardCompany({
      gateway: admin.gateway,
      application: { ...application, shopifyCompanyId: "gid://shopify/Company/1" },
      decision,
      onCompanyCreated: async () => {},
    });
    expect(admin.ops("CompanyCreate")).toHaveLength(0);
    expect(admin.ops("CompanyContactAssignRole")).toHaveLength(0);
    expect(admin.ops("CatalogContextUpdate")).toHaveLength(1);
  });
});
