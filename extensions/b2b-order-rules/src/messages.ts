export type Locale = "en" | "fr";

const MESSAGES = {
  en: {
    brandNotAuthorized:
      "{product} ({brand}) is not part of your distribution agreement. Please remove it from your order.",
    casePack: "{product} is sold by cases of {casePack}. Please order a multiple of {casePack}.",
    minimumOrder:
      "The minimum order for {location} is {minimum}. Add {missing} to place your order.",
  },
  fr: {
    brandNotAuthorized:
      "{product} ({brand}) ne fait pas partie de votre contrat de distribution. Merci de le retirer de la commande.",
    casePack: "{product} est vendu par colis de {casePack}. Merci de commander un multiple de {casePack}.",
    minimumOrder:
      "Le minimum de commande pour {location} est de {minimum}. Ajoutez {missing} pour valider la commande.",
  },
} as const;

export type MessageKey = keyof (typeof MESSAGES)["en"];

export function translate(
  locale: Locale,
  key: MessageKey,
  vars: Record<string, string | number>,
): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
