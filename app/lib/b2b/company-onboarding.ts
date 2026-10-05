import { assertNoUserErrors, type AdminGateway, type UserError } from "../shopify/admin-gateway";
import { METAFIELDS } from "./metafields";

/** Subset of the WholesaleApplication row needed to create a company. */
export interface ApplicationForOnboarding {
  id: string;
  companyName: string;
  vatNumber: string | null;
  segment: string;
  website: string | null;
  contactFirstName: string;
  contactLastName: string;
  email: string;
  phone: string | null;
  address1: string;
  city: string;
  zip: string;
  countryCode: string;
  locale: string;
  shopifyCompanyId: string | null;
}

export interface OnboardingDecision {
  /** Catalog (and therefore price list / assortment) assigned to the location. */
  catalogId: string;
  paymentTermsTemplateId: string | null;
  authorizedBrands: string[];
  minimumOrderAmount: string | null;
}

export function externalCompanyId(application: Pick<ApplicationForOnboarding, "id" | "countryCode">) {
  return `B2B-${application.countryCode.toUpperCase()}-${application.id.slice(-8).toUpperCase()}`;
}

/** Pure mapping, unit tested: WholesaleApplication -> companyCreate input. */
export function buildCompanyCreateInput(
  application: ApplicationForOnboarding,
  decision: Pick<OnboardingDecision, "paymentTermsTemplateId">,
) {
  const address = {
    address1: application.address1,
    city: application.city,
    zip: application.zip,
    countryCode: application.countryCode.toUpperCase(),
    recipient: application.companyName,
    firstName: application.contactFirstName,
    lastName: application.contactLastName,
    ...(application.phone ? { phone: application.phone } : {}),
  };

  return {
    company: {
      name: application.companyName,
      externalId: externalCompanyId(application),
      customerSince: new Date().toISOString(),
      note: [
        `Segment: ${application.segment}`,
        application.website ? `Website: ${application.website}` : null,
        `Onboarded from wholesale application ${application.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    companyContact: {
      firstName: application.contactFirstName,
      lastName: application.contactLastName,
      email: application.email.toLowerCase(),
      locale: application.locale,
      ...(application.phone ? { phone: application.phone } : {}),
    },
    companyLocation: {
      name: `${application.companyName} — ${application.city}`,
      locale: application.locale,
      externalId: `${externalCompanyId(application)}-01`,
      shippingAddress: address,
      billingSameAsShipping: true,
      ...(application.vatNumber ? { taxRegistrationId: application.vatNumber } : {}),
      buyerExperienceConfiguration: {
        // Orders go straight to checkout; the ERP is the system of record for credit checks.
        checkoutToDraft: false,
        // Brands control their distribution network: ship-to addresses are vetted.
        editableShippingAddress: false,
        ...(decision.paymentTermsTemplateId
          ? { paymentTermsTemplateId: decision.paymentTermsTemplateId }
          : {}),
      },
    },
  };
}

const COMPANY_CREATE = `#graphql
  mutation CompanyCreate($input: CompanyCreateInput!) {
    companyCreate(input: $input) {
      company { id }
      userErrors { field message code }
    }
  }`;

const COMPANY_STRUCTURE = `#graphql
  query CompanyStructure($id: ID!) {
    company(id: $id) {
      id
      mainContact { id }
      contactRoles(first: 10) { nodes { id name } }
      locations(first: 1) {
        nodes {
          id
          roleAssignments(first: 10) { nodes { companyContact { id } } }
        }
      }
    }
  }`;

const ASSIGN_ROLE = `#graphql
  mutation CompanyContactAssignRole($contactId: ID!, $roleId: ID!, $locationId: ID!) {
    companyContactAssignRole(
      companyContactId: $contactId
      companyContactRoleId: $roleId
      companyLocationId: $locationId
    ) {
      companyContactRoleAssignment { id }
      userErrors { field message code }
    }
  }`;

const CATALOG_CONTEXT_UPDATE = `#graphql
  mutation CatalogContextUpdate($catalogId: ID!, $contexts: CatalogContextInput!) {
    catalogContextUpdate(catalogId: $catalogId, contextsToAdd: $contexts) {
      catalog { id }
      userErrors { field message code }
    }
  }`;

const METAFIELDS_SET = `#graphql
  mutation B2bMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }`;

interface CompanyStructure {
  company: {
    id: string;
    mainContact: { id: string } | null;
    contactRoles: { nodes: { id: string; name: string }[] };
    locations: {
      nodes: {
        id: string;
        roleAssignments: { nodes: { companyContact: { id: string } }[] };
      }[];
    };
  } | null;
}

/**
 * Turns an approved application into a Shopify B2B company. Written as a
 * resumable saga: the company id is persisted right after creation, and every
 * following step is idempotent, so a failed approval can simply be retried.
 */
export async function onboardCompany({
  gateway,
  application,
  decision,
  onCompanyCreated,
}: {
  gateway: AdminGateway;
  application: ApplicationForOnboarding;
  decision: OnboardingDecision;
  onCompanyCreated: (companyId: string) => Promise<void>;
}): Promise<{ companyId: string; locationId: string }> {
  // 1. Company + main contact + first location, in a single mutation.
  let companyId = application.shopifyCompanyId;
  if (!companyId) {
    const data = await gateway.request<{
      companyCreate: { company: { id: string } | null; userErrors: UserError[] };
    }>(COMPANY_CREATE, { input: buildCompanyCreateInput(application, decision) });
    companyId = assertNoUserErrors("companyCreate", data.companyCreate).company!.id;
    await onCompanyCreated(companyId);
  }

  const { company } = await gateway.request<CompanyStructure>(COMPANY_STRUCTURE, { id: companyId });
  const location = company?.locations.nodes[0];
  if (!company?.mainContact || !location) {
    throw new Error(`Company ${companyId} has no main contact or location`);
  }

  // 2. Allow the contact to order for the location (skipped if already assigned).
  const alreadyAssigned = location.roleAssignments.nodes.some(
    (a) => a.companyContact.id === company.mainContact!.id,
  );
  if (!alreadyAssigned) {
    const role =
      company.contactRoles.nodes.find((r) => r.name === "Ordering only") ??
      company.contactRoles.nodes[0];
    if (!role) throw new Error("No company contact role available");
    const data = await gateway.request<{ companyContactAssignRole: { userErrors: UserError[] } }>(
      ASSIGN_ROLE,
      { contactId: company.mainContact.id, roleId: role.id, locationId: location.id },
    );
    assertNoUserErrors("companyContactAssignRole", data.companyContactAssignRole);
  }

  // 3. Catalog: what this retailer can see and at which price.
  const catalog = await gateway.request<{ catalogContextUpdate: { userErrors: UserError[] } }>(
    CATALOG_CONTEXT_UPDATE,
    { catalogId: decision.catalogId, contexts: { companyLocationIds: [location.id] } },
  );
  assertNoUserErrors("catalogContextUpdate", catalog.catalogContextUpdate);

  // 4. Business rules read at checkout by the b2b-order-rules Function.
  const metafields = [
    {
      ownerId: companyId,
      ...METAFIELDS.authorizedBrands,
      value: JSON.stringify(decision.authorizedBrands),
    },
    ...(decision.minimumOrderAmount
      ? [{ ownerId: location.id, ...METAFIELDS.minimumOrderAmount, value: decision.minimumOrderAmount }]
      : []),
  ].map(({ ownerId, namespace, key, type, value }) => ({ ownerId, namespace, key, type, value }));
  const set = await gateway.request<{ metafieldsSet: { userErrors: UserError[] } }>(METAFIELDS_SET, {
    metafields,
  });
  assertNoUserErrors("metafieldsSet", set.metafieldsSet);

  return { companyId, locationId: location.id };
}
