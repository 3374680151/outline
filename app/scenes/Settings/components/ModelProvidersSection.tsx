import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import { TeamPreference } from "@shared/types";
import { modelBinding } from "@shared/utils/aiModelBinding";
import Text from "~/components/Text";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import { client } from "~/utils/ApiClient";
import SettingRow from "./SettingRow";
import { ModelSyncDialog } from "./ModelConfig/ModelSyncDialog";
import { ProviderConfigModal } from "./ModelConfig/ProviderConfigModal";
import { ProviderDetailPane } from "./ModelConfig/ProviderDetailPane";
import { ProviderListPane } from "./ModelConfig/ProviderListPane";
import {
  type ModelProviderInfo,
  usableModelOf,
} from "./ModelConfig/types";

/**
 * The model gateway section of the AI services settings page: per-feature
 * bindings (translation / proofreading), a grouped provider list on the
 * left, and the provider detail on the right with model checklists,
 * upstream sync, and connection tests.
 */
function ModelProvidersSection() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const [providers, setProviders] = React.useState<ModelProviderInfo[] | null>(
    null
  );
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testResults, setTestResults] = React.useState<
    Record<string, { ok: boolean; text: string }>
  >({});
  const [modalRow, setModalRow] = React.useState<
    ModelProviderInfo | "new" | null
  >(null);
  const [syncTarget, setSyncTarget] = React.useState<ModelProviderInfo | null>(
    null
  );

  const load = React.useCallback(async () => {
    try {
      const res = await client.post("/aiModelProviders.info", {});
      const rows = res.data.providers as ModelProviderInfo[];
      setProviders(rows);
      setSelectedId((current) =>
        rows.some((row) => row.id === current) ? current : (rows[0]?.id ?? null)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selected =
    providers?.find((row) => row.id === selectedId) ?? null;

  const replaceRow = React.useCallback((row: ModelProviderInfo) => {
    setProviders((current) =>
      (current ?? []).map((entry) => (entry.id === row.id ? row : entry))
    );
  }, []);

  const handleToggle = React.useCallback(
    async (row: ModelProviderInfo, enabled: boolean) => {
      const res = await client.post("/aiModelProviders.update", {
        id: row.id,
        enabled,
      });
      replaceRow(res.data.provider as ModelProviderInfo);
    },
    [replaceRow]
  );

  const handleCheckModel = React.useCallback(
    async (row: ModelProviderInfo, modelId: string, checked: boolean) => {
      const current = row.models
        .filter((model) =>
          model.id === modelId ? checked : model.enabled
        )
        .map((model) => model.id);
      const res = await client.post("/aiModelProviders.setModels", {
        id: row.id,
        models: current,
      });
      replaceRow(res.data.provider as ModelProviderInfo);
    },
    [replaceRow]
  );

  const handleDefault = React.useCallback(
    async (row: ModelProviderInfo, modelId: string) => {
      const res = await client.post("/aiModelProviders.update", {
        id: row.id,
        model: modelId,
      });
      replaceRow(res.data.provider as ModelProviderInfo);
      toast.success(
        modelId
          ? t("Default model set to {{model}}", { model: modelId })
          : t("Default model cleared")
      );
    },
    [replaceRow, t]
  );

  const handleAddModel = React.useCallback(
    async (row: ModelProviderInfo, model: string) => {
      const res = await client.post("/aiModelProviders.addModel", {
        id: row.id,
        model,
      });
      replaceRow(res.data.provider as ModelProviderInfo);
      toast.success(t("Added {{model}}", { model }));
    },
    [replaceRow, t]
  );

  const handleDelete = React.useCallback(
    async (row: ModelProviderInfo) => {
      await client.post("/aiModelProviders.delete", { id: row.id });
      const remaining = (providers ?? []).filter((entry) => entry.id !== row.id);
      setProviders(remaining);
      if (selectedId === row.id) {
        setSelectedId(remaining[0]?.id ?? null);
      }
      toast.success(t("Deleted {{name}}", { name: row.name }));
    },
    [providers, selectedId, t]
  );

  const handleTest = React.useCallback(
    async (row: ModelProviderInfo) => {
      const model = usableModelOf(row);

      if (!model) {
        toast.warning(
          t("Check a model or set the default model first, then test")
        );
        return;
      }

      setTestingId(row.id);
      setTestResults((current) => {
        const next = {
          ...current,
        };
        delete next[row.id];
        return next;
      });

      try {
        const res = await client.post("/aiModelProviders.test", {
          id: row.id,
          model,
        });
        const result = res.data as {
          ok: boolean;
          latencyMs: number;
          error?: string;
        };
        setTestResults((current) => ({
          ...current,
          [row.id]: result.ok
            ? {
                ok: true,
                text: `✓ ${model} · ${(result.latencyMs / 1000).toFixed(1)}s`,
              }
            : {
                ok: false,
                text: `✗ ${result.error ?? t("Connection test failed")}`,
              },
        }));
      } catch (err) {
        setTestResults((current) => ({
          ...current,
          [row.id]: {
            ok: false,
            text: err instanceof Error ? err.message : t("Connection test failed"),
          },
        }));
      } finally {
        setTestingId(null);
      }
    },
    [t]
  );

  const handleApplyTo = React.useCallback(
    async (row: ModelProviderInfo, feature: "translation" | "proofread") => {
      const preference =
        feature === "translation"
          ? TeamPreference.TranslationModel
          : TeamPreference.ProofreadModel;
      team.setPreference(preference, modelBinding(row.id));
      await team.save();
      toast.success(
        feature === "translation"
          ? t("Bound to translation")
          : t("Bound to proofreading")
      );
    },
    [team, t]
  );

  const handleSaved = React.useCallback(
    (row: ModelProviderInfo) => {
      setProviders((current) => {
        const exists = (current ?? []).some((entry) => entry.id === row.id);
        return exists
          ? (current ?? []).map((entry) =>
              entry.id === row.id ? row : entry
            )
          : [...(current ?? []), row];
      });
      setSelectedId(row.id);
    },
    []
  );

  const handleOpenCreate = React.useCallback(() => {
    setModalRow("new");
  }, []);

  const handleOpenEdit = React.useCallback((row: ModelProviderInfo) => {
    setModalRow(row);
  }, []);

  const handleOpenSync = React.useCallback((row: ModelProviderInfo) => {
    setSyncTarget(row);
  }, []);

  const translationBinding = String(
    team.getPreference(TeamPreference.TranslationModel) || ""
  );
  const proofreadBinding = String(
    team.getPreference(TeamPreference.ProofreadModel) || ""
  );

  const handleBindingChange = React.useCallback(
    async (preference: TeamPreference, value: string) => {
      team.setPreference(preference, value);
      await team.save();
      toast.success(t("Settings saved"));
    },
    [team, t]
  );

  const usableModels = (providers ?? [])
    .filter((row) => row.enabled && row.hasApiKey)
    .reduce((total, row) => total + row.modelCount, 0);
  const pendingKeys = (providers ?? []).filter((row) => !row.hasApiKey).length;

  return (
    <>
      <SettingRow
        name={TeamPreference.TranslationModel}
        label={t("Translation binding")}
        description={t(
          "The model gateway used for bilingual translation when the request does not pick one. Leave automatic to try every configured provider in order."
        )}
      >
        {providers === null ? null : (
          <BindSelect
            value={translationBinding}
            aria-label={t("Translation binding")}
            onChange={(event) =>
              void handleBindingChange(
                TeamPreference.TranslationModel,
                event.target.value
              )
            }
          >
            <option value="">{t("Automatic (default route)")}</option>
            {(providers ?? [])
              .filter((row) => row.enabled)
              .map((row) => (
                <option key={row.id} value={modelBinding(row.id)}>
                  {row.model ? `${row.name} · ${row.model}` : row.name}
                </option>
              ))}
          </BindSelect>
        )}
      </SettingRow>

      <SettingRow
        name={TeamPreference.ProofreadModel}
        label={t("Proofreading binding")}
        description={t(
          "The model gateway used by the LLM grammar check. Leave automatic to use the first configured gateway."
        )}
        border={false}
      >
        {providers === null ? null : (
          <BindSelect
            value={proofreadBinding}
            aria-label={t("Proofreading binding")}
            onChange={(event) =>
              void handleBindingChange(
                TeamPreference.ProofreadModel,
                event.target.value
              )
            }
          >
            <option value="">{t("Automatic (default route)")}</option>
            {(providers ?? [])
              .filter((row) => row.enabled)
              .map((row) => (
                <option key={row.id} value={modelBinding(row.id)}>
                  {row.model ? `${row.name} · ${row.model}` : row.name}
                </option>
              ))}
          </BindSelect>
        )}
      </SettingRow>

      <StatRow>
        <Stats>
          {providers !== null && (
            <>
              {t("{{count}} providers", { count: providers.length })} ·{" "}
              {t("{{count}} usable models", { count: usableModels })}
              {pendingKeys > 0 &&
                ` · ${t("{{count}} missing keys", { count: pendingKeys })}`}
            </>
          )}
        </Stats>
      </StatRow>

      <Layout>
        <ProviderListPane
          rows={providers ?? []}
          selectedId={selectedId}
          onSelect={(row) => setSelectedId(row.id)}
          onToggle={handleToggle}
          onAdd={handleOpenCreate}
        />
        <ProviderDetailPane
          row={selected}
          hasProviders={(providers?.length ?? 0) > 0}
          testing={!!selected && testingId === selected.id}
          testResult={selected ? (testResults[selected.id] ?? null) : null}
          translationBound={
            !!selected && translationBinding === modelBinding(selected.id)
          }
          proofreadBound={
            !!selected && proofreadBinding === modelBinding(selected.id)
          }
          onEdit={handleOpenEdit}
          onTest={handleTest}
          onSync={handleOpenSync}
          onCheckModel={handleCheckModel}
          onDefault={handleDefault}
          onAddModel={handleAddModel}
          onDelete={handleDelete}
          onApplyTo={handleApplyTo}
        />
      </Layout>

      {loading && <LoadingHint>{t("Loading…")}</LoadingHint>}

      {modalRow !== null && (
        <ProviderConfigModal
          row={modalRow === "new" ? undefined : modalRow}
          onSaved={(row) => {
            handleSaved(row);
            setModalRow(null);
            toast.success(
              modalRow === "new"
                ? t("Created {{name}}", { name: row.name })
                : t("Saved")
            );
          }}
          onClose={() => setModalRow(null)}
        />
      )}

      {syncTarget && (
        <ModelSyncDialog
          name={syncTarget.name}
          providerId={syncTarget.id}
          existing={syncTarget.models}
          onApply={async (ids) => {
            const res = await client.post("/aiModelProviders.setModels", {
              id: syncTarget.id,
              models: ids,
            });
            replaceRow(res.data.provider as ModelProviderInfo);
            setSyncTarget(null);
            toast.success(
              t("Synced {{name}} from upstream", { name: syncTarget.name })
            );
          }}
          onClose={() => setSyncTarget(null)}
        />
      )}

      <Hint>
        <Text type="secondary" as="p">
          {t(
            "Tip: configure a static provider below when you only have one OpenAI-compatible endpoint or a DeepL key — translation and grammar checking fall back to it automatically."
          )}
        </Text>
      </Hint>
    </>
  );
}

const BindSelect = styled.select`
  min-width: 220px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid ${s("inputBorder")};
  border-radius: 4px;
  background: ${s("background")};
  color: ${s("text")};
  font-size: 14px;
`;

const StatRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: baseline;
  margin-bottom: 12px;
`;

const Stats = styled.p`
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  color: ${s("textSecondary")};
`;

const Layout = styled.div`
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-height: 320px;
`;

const LoadingHint = styled.div`
  margin-top: 8px;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const Hint = styled.div`
  margin-top: 8px;
  font-size: 13px;
`;

export default observer(ModelProvidersSection);
