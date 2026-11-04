import { aiVendorTemplates, type AiVendorKind } from "@shared/aiVendorTemplates";

/** One model of a provider as returned by `aiModelProviders.info`. */
export interface ProviderModelInfo {
  id: string;
  enabled: boolean;
  source: string;
}

/** One configured model provider as returned by `aiModelProviders.info`. */
export type ModelProviderInfo = {
  id: string;
  name: string;
  vendor: string;
  protocol: string;
  baseUrl: string;
  model: string | null;
  hasApiKey: boolean;
  keyHint?: string;
  enabled: boolean;
  models: ProviderModelInfo[];
  modelCount: number;
  createdAt: string;
};

/** vendor slug → display name / kind, built from the shared templates. */
export const vendorMeta: Record<string, { name: string; kind: AiVendorKind }> =
  Object.fromEntries(
    aiVendorTemplates.map((template) => [
      template.vendor,
      {
        name: template.name,
        kind: template.kind,
      },
    ])
  );

/** The four fixed groups of the provider list; empty groups are hidden. */
export const PROVIDER_GROUPS: {
  kind: AiVendorKind | "custom";
  labelKey: string;
}[] = [
  {
    kind: "official",
    labelKey: "Official vendors",
  },
  {
    kind: "relay",
    labelKey: "Relay aggregators",
  },
  {
    kind: "local",
    labelKey: "Self-hosted",
  },
  {
    kind: "custom",
    labelKey: "Custom",
  },
];

/**
 * The catalog kind of a provider row: the vendor template's kind when the row
 * is linked to one, otherwise the custom group.
 *
 * @param row The provider row.
 * @returns The group kind.
 */
export function kindOfRow(row: ModelProviderInfo): AiVendorKind | "custom" {
  return (row.vendor && vendorMeta[row.vendor]?.kind) || "custom";
}

/**
 * The first usable model of a provider: the default model when set, then the
 * first enabled model.
 *
 * @param row The provider row.
 * @returns The model id, or an empty string when none is usable.
 */
export function usableModelOf(row: ModelProviderInfo): string {
  if (!row.enabled) {
    return "";
  }

  return row.model || row.models.find((model) => model.enabled)?.id || "";
}
