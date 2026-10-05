import "@shopify/ui-extensions/preact";
import { render } from "preact";
import {
  useApplyAttributeChange,
  useAttributeValues,
  useInstructions,
  usePurchasingCompany,
  useTranslate,
} from "@shopify/ui-extensions/checkout/preact";

/**
 * Keys must match CHECKOUT_ATTRIBUTES in app/lib/b2b/order-export.ts:
 * they become order note attributes and are exported to the ERP.
 */
const DELIVERY_DATE = "Requested delivery date";
const COST_CENTER = "Cost center";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const translate = useTranslate();
  const purchasingCompany = usePurchasingCompany();
  const instructions = useInstructions();
  const applyAttributeChange = useApplyAttributeChange();
  const [deliveryDate, costCenter] = useAttributeValues([DELIVERY_DATE, COST_CENTER]);

  // B2B only: retail buyers never see this block.
  if (!purchasingCompany) return null;

  if (!instructions.attributes.canUpdateAttributes) {
    return <s-banner tone="warning">{translate("notEditable")}</s-banner>;
  }

  const save = (key: string, value: string) =>
    applyAttributeChange(
      value.trim()
        ? { type: "updateAttribute", key, value: value.trim() }
        : { type: "removeAttribute", key },
    );

  return (
    <s-stack gap="base">
      <s-heading>
        {translate("heading", { company: purchasingCompany.company.name ?? "" })}
      </s-heading>
      <s-date-field
        label={translate("deliveryDate")}
        name="requestedDeliveryDate"
        value={deliveryDate ?? ""}
        allow={`${tomorrow()}--`}
        onChange={(event) => save(DELIVERY_DATE, valueOf(event))}
      />
      <s-text type="small" color="subdued">
        {translate("deliveryDateHelp")}
      </s-text>
      <s-text-field
        label={translate("costCenter")}
        name="costCenter"
        value={costCenter ?? ""}
        maxLength={40}
        onChange={(event) => save(COST_CENTER, valueOf(event))}
      />
    </s-stack>
  );
}

function valueOf(event: Event) {
  return (event.currentTarget as HTMLInputElement | null)?.value ?? "";
}

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}
