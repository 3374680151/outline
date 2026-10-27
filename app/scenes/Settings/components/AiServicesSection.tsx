import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import { TeamPreference } from "@shared/types";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import { client } from "~/utils/ApiClient";
import SettingRow from "./SettingRow";

/** One configured AI service as returned by `aiConfig.info`. */
type ProviderInfo = {
  providerId: string;
  label: string;
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
  keyHint?: string;
  isDefault: boolean;
  fromEnvironment: boolean;
};

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; latencyMs: number }
  | { status: "failed"; error: string };

/**
 * Workspace level configuration for the AI services backing translation and
 * grammar checking: the OpenAI-compatible endpoint, DeepL, and LanguageTool.
 * Credentials are stored encrypted server-side; only admins can read this
 * page and keys are never returned in full.
 */
export const AiServicesSection = observer(function AiServicesSection() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const [providers, setProviders] = React.useState<ProviderInfo[] | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await client.post("/aiConfig.info", {});
      setProviders(res.data.providers);
    } catch (_err) {
      setProviders([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleSaved = React.useCallback(() => {
    toast.success(t("Settings saved"));
    void load();
  }, [load, t]);

  const handleTeamPref = React.useCallback(
    async (preference: TeamPreference, checked: boolean) => {
      team.setPreference(preference, checked);
      await team.save();
      toast.success(t("Settings saved"));
    },
    [team, t]
  );

  return (
    <>
      <Heading as="h2">{t("Translation & grammar services")}</Heading>
      <Text as="p" type="secondary">
        {t(
          "Configure the AI services used by the bilingual editor. Keys are encrypted at rest and never shown in full. Workspace configuration takes precedence over environment variables."
        )}
      </Text>

      <SettingRow
        name={TeamPreference.BilingualEditor}
        label={t("Bilingual editor")}
        description={t(
          "Allow the bilingual split view, document menu entry, and bilingual document list for everyone in the workspace."
        )}
        border
      >
        <Switch
          id={TeamPreference.BilingualEditor}
          name={TeamPreference.BilingualEditor}
          checked={team.getPreference(TeamPreference.BilingualEditor)}
          onChange={(checked) =>
            void handleTeamPref(TeamPreference.BilingualEditor, checked)
          }
        />
      </SettingRow>
      <SettingRow
        name={TeamPreference.GrammarChecking}
        label={t("Grammar checking")}
        description={t(
          "Master switch for grammar checking across the workspace. Individual members can turn it off for themselves."
        )}
        border={false}
      >
        <Switch
          id={TeamPreference.GrammarChecking}
          name={TeamPreference.GrammarChecking}
          checked={team.getPreference(TeamPreference.GrammarChecking)}
          onChange={(checked) =>
            void handleTeamPref(TeamPreference.GrammarChecking, checked)
          }
        />
      </SettingRow>

      {!providers ? null : (
        <Cards>
          {providers.map((provider) => (
            <ProviderCard
              key={provider.providerId}
              provider={provider}
              onSaved={handleSaved}
            />
          ))}
        </Cards>
      )}
    </>
  );
});

/** One editable provider card with connection test. */
const ProviderCard = observer(function ProviderCard({
  provider,
  onSaved,
}: {
  provider: ProviderInfo;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isLanguageTool = provider.providerId === "languagetool";
  const isLanguageModel = provider.providerId === "openai-compatible";
  const configurable = provider.providerId !== "microsoft-free";

  const [baseUrl, setBaseUrl] = React.useState(provider.baseUrl ?? "");
  const [model, setModel] = React.useState(provider.model ?? "");
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [test, setTest] = React.useState<TestState>({ status: "idle" });
  const [models, setModels] = React.useState<string[] | null>(null);

  const dirty =
    baseUrl !== (provider.baseUrl ?? "") ||
    model !== (provider.model ?? "") ||
    apiKey !== "";

  React.useEffect(() => {
    setBaseUrl(provider.baseUrl ?? "");
    setModel(provider.model ?? "");
    setApiKey("");
    setTest({ status: "idle" });
    setModels(null);
  }, [provider.baseUrl, provider.model, provider.keyHint]);

  const handleSave = React.useCallback(async () => {
    setSaving(true);

    try {
      await client.post("/aiConfig.update", {
        providerId: provider.providerId,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      onSaved();
    } catch (_err) {
      toast.error(t("Could not save the configuration"));
    } finally {
      setSaving(false);
    }
  }, [provider.providerId, baseUrl, model, apiKey, onSaved, t]);

  const handleSetDefault = React.useCallback(async () => {
    try {
      await client.post("/aiConfig.update", {
        providerId: provider.providerId,
        isDefault: true,
      });
      onSaved();
    } catch (_err) {
      toast.error(t("Could not save the configuration"));
    }
  }, [provider.providerId, onSaved, t]);

  const handleTest = React.useCallback(async () => {
    setTest({ status: "running" });

    try {
      const res = await client.post("/aiConfig.test", {
        providerId: provider.providerId,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      const result = res.data as {
        ok: boolean;
        latencyMs: number;
        error?: string;
      };

      setTest(
        result.ok
          ? { status: "ok", latencyMs: result.latencyMs }
          : { status: "failed", error: result.error ?? "failed" }
      );
    } catch (_err) {
      setTest({ status: "failed", error: "request failed" });
    }
  }, [provider.providerId, baseUrl, model, apiKey]);

  const handleFetchModels = React.useCallback(async () => {
    try {
      const res = await client.post("/aiConfig.models", {
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
      });
      const data = res.data as { models: string[]; error?: string };

      if (data.error) {
        toast.error(t("Could not fetch models: {{error}}", { error: data.error }));
        return;
      }

      setModels(data.models);
      toast.success(t("{{count}} models available", { count: data.models.length }));
    } catch (_err) {
      toast.error(t("Could not fetch models"));
    }
  }, [baseUrl, apiKey, t]);

  if (!configurable) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <Title>{provider.label}</Title>
        <Badges>
          {provider.isDefault && <Badge tone="accent">{t("Default")}</Badge>}
          {(provider.hasApiKey || provider.fromEnvironment) && (
            <Badge>{t("Configured")}</Badge>
          )}
        </Badges>
      </CardHeader>

      {(provider.baseUrl !== null || isLanguageTool || isLanguageModel) && (
        <Field>
          <Label>{t("API endpoint")}</Label>
          <Input
            value={baseUrl}
            placeholder={
              isLanguageTool
                ? "http://languagetool:8081"
                : "https://api.example.com/v1"
            }
            onChange={(event) => setBaseUrl(event.currentTarget.value)}
          />
        </Field>
      )}

      {!isLanguageTool && (
        <Field>
          <Label>{t("API key")}</Label>
          <Input
            type="password"
            value={apiKey}
            placeholder={
              provider.keyHint ? `•••• ${provider.keyHint}` : t("Not set")
            }
            onChange={(event) => setApiKey(event.currentTarget.value)}
            autoComplete="new-password"
          />
        </Field>
      )}

      {isLanguageModel && (
        <Field>
          <Label>{t("Model")}</Label>
          <ModelRow>
            <Input
              value={model}
              placeholder="gpt-4o-mini"
              onChange={(event) => setModel(event.currentTarget.value)}
            />
            <Button neutral onClick={handleFetchModels} disabled={!baseUrl}>
              {t("Fetch models")}
            </Button>
          </ModelRow>
          {models && (
            <ModelList>
              {models.slice(0, 40).map((id) => (
                <ModelOption
                  key={id}
                  type="button"
                  onClick={() => setModel(id)}
                  $active={model === id}
                >
                  {id}
                </ModelOption>
              ))}
            </ModelList>
          )}
        </Field>
      )}

      <Actions>
        <Button disabled={saving || !dirty} onClick={handleSave}>
          {t("Save")}
        </Button>
        <Button neutral onClick={handleTest} disabled={test.status === "running"}>
          {test.status === "running" ? t("Testing…") : t("Test connection")}
        </Button>
        {!provider.isDefault && !isLanguageTool && (
          <Button neutral onClick={handleSetDefault}>
            {t("Set as default")}
          </Button>
        )}
        <TestResult>
          {test.status === "ok" && (
            <span>
              {t("Connected in {{ms}}ms", { ms: test.latencyMs })}
            </span>
          )}
          {test.status === "failed" && <Failed>{test.error}</Failed>}
        </TestResult>
      </Actions>
    </Card>
  );
});

const Cards = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 12px;
`;

const Card = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const Title = styled.h3`
  margin: 0;
  font-size: 15px;
`;

const Badges = styled.div`
  display: flex;
  gap: 6px;
`;

const Badge = styled.span<{ tone?: string }>`
  font-size: 11px;
  font-weight: 600;
  border-radius: 99px;
  padding: 2px 8px;
  background: ${(props) =>
    props.tone === "accent" ? s("accent") : s("backgroundSecondary")};
  color: ${(props) => (props.tone === "accent" ? "#fff" : s("textSecondary"))};
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled(Text)`
  font-size: 13px;
  font-weight: 500;
`;

const ModelRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const ModelList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-height: 120px;
  overflow-y: auto;
  margin-top: 4px;
`;

const ModelOption = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? s("accent") : s("backgroundSecondary"))};
  color: ${(props) => (props.$active ? "#fff" : s("textSecondary"))};
  border: none;
  border-radius: 4px;
  font-size: 11.5px;
  padding: 2px 8px;
  cursor: pointer;
`;

const Actions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const TestResult = styled.span`
  font-size: 12.5px;
  color: ${s("textSecondary")};
  margin-left: 4px;
`;

const Failed = styled.span`
  color: ${s("danger")};
`;
