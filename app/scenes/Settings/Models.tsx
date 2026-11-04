import { observer } from "mobx-react";
import { DatabaseIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import { TeamPreference } from "@shared/types";
import { modelBinding } from "@shared/utils/aiModelBinding";
import Heading from "~/components/Heading";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import { client } from "~/utils/ApiClient";
import {
  ModelSyncDialog,
} from "./components/ModelConfig/ModelSyncDialog";
import { ProviderConfigModal } from "./components/ModelConfig/ProviderConfigModal";
import { ProviderDetailPane } from "./components/ModelConfig/ProviderDetailPane";
import { ProviderListPane } from "./components/ModelConfig/ProviderListPane";
import {
  type ModelProviderInfo,
  usableModelOf,
} from "./components/ModelConfig/types";

/**
 * The dedicated model configuration page, ported from the FluentRead-Go
 * models view: a summary line, a grouped provider list on the left, and the
 * provider detail on the right with model checklists, upstream sync, and
 * per-feature binding.
 */
function Models() {
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

  const bindingLabel = (binding: string) => {
    const row = providers?.find((entry) => binding === modelBinding(entry.id));

    if (row) {
      return row.model ? `${row.name} · ${row.model}` : row.name;
    }

    return t("Automatic (default route)");
  };

  const usableModels = (providers ?? [])
    .filter((row) => row.enabled && row.hasApiKey)
    .reduce((total, row) => total + row.modelCount, 0);
  const pendingKeys = (providers ?? []).filter((row) => !row.hasApiKey).length;

  return (
    <Scene title={t("Models")} icon={<DatabaseIcon />}>
      <Heading>{t("Models")}</Heading>
      <Text as="p" type="secondary">
        {t(
          "Configure the model providers used for translation and grammar checking. Keys are encrypted at rest and never shown in full."
        )}
      </Text>

      <StatRow>
        <Stats>
          {providers !== null && (
            <>
              {t("{{count}} providers", { count: providers.length })} ·{" "}
              {t("{{count}} usable models", { count: usableModels })}
              {pendingKeys > 0 &&
                ` · ${t("{{count}} missing keys", { count: pendingKeys })}`}
              {" · "}
              {t("Translation")}: {bindingLabel(translationBinding)} ·{" "}
              {t("Proofreading")}: {bindingLabel(proofreadBinding)}
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
    </Scene>
  );
}

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

export default observer(Models);
