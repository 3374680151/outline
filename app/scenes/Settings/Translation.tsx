import { observer } from "mobx-react";
import { GlobeIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { translationLanguages } from "@shared/constants";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import { client } from "~/utils/ApiClient";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import { ActionRow } from "./components/ActionRow";
import SettingRow from "./components/SettingRow";

function Translation() {
  const { t } = useTranslation();
  const team = useCurrentTeam();

  const [baseUrl, setBaseUrl] = React.useState(
    team.translation?.baseUrl ?? "https://api.openai.com/v1"
  );
  const [model, setModel] = React.useState(
    team.translation?.model ?? "gpt-4o-mini"
  );
  const [targetLanguage, setTargetLanguage] = React.useState(
    team.translation?.targetLanguage ?? "zh-CN"
  );
  const [apiKey, setApiKey] = React.useState("");
  const [isSaving, setSaving] = React.useState(false);

  const languageOptions: Option[] = React.useMemo(
    () =>
      translationLanguages.map((language) => ({
        type: "item" as const,
        value: language.value,
        label: language.label,
      })),
    []
  );

  const handleTargetLanguageChange = React.useCallback((value: string) => {
    setTargetLanguage(value);
  }, []);

  const handleSubmit = React.useCallback(
    async (event?: React.SyntheticEvent) => {
      if (event) {
        event.preventDefault();
      }

      setSaving(true);
      try {
        const res = await client.post("/translations.updateConfig", {
          baseUrl,
          model,
          targetLanguage,
          // An empty key keeps the previously stored key.
          ...(apiKey ? { apiKey } : {}),
        });
        team.updateData(res.data);
        setApiKey("");
        toast.success(t("Settings saved"));
      } catch (err) {
        toast.error(errToString(err));
      } finally {
        setSaving(false);
      }
    },
    [baseUrl, model, targetLanguage, apiKey, team, t]
  );

  return (
    <Scene title={t("Translation")} icon={<GlobeIcon />}>
      <Heading>{t("Translation")}</Heading>
      <Text as="p" type="secondary">
        {t(
          "Translation works out of the box using built-in free translation services (Microsoft Translate and Bilibili Translate). Optionally configure an OpenAI-compatible provider – OpenAI, DeepSeek, Moonshot and compatible services – for higher quality translations."
        )}
      </Text>

      <form onSubmit={handleSubmit}>
        <SettingRow
          label={t("API base URL")}
          name="baseUrl"
          description={t(
            "The base URL of the API, without a trailing slash, e.g. https://api.openai.com/v1"
          )}
        >
          <Input
            id="baseUrl"
            value={baseUrl}
            onChange={(ev: React.ChangeEvent<HTMLInputElement>) => {
              setBaseUrl(ev.target.value);
            }}
            autoComplete="off"
            required
          />
        </SettingRow>
        <SettingRow
          label={t("API key")}
          name="apiKey"
          description={t(
            "Optional. When set, translations use this provider instead of the built-in free services. The key is stored encrypted and only used server-side. Leave empty to keep the existing key."
          )}
        >
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(ev: React.ChangeEvent<HTMLInputElement>) => {
              setApiKey(ev.target.value);
            }}
            placeholder={
              team.translation?.configured
                ? t("Configured – leave empty to keep")
                : undefined
            }
            autoComplete="new-password"
          />
        </SettingRow>
        <SettingRow
          label={t("Model")}
          name="model"
          description={t("The model used for translation requests.")}
        >
          <Input
            id="model"
            value={model}
            onChange={(ev: React.ChangeEvent<HTMLInputElement>) => {
              setModel(ev.target.value);
            }}
            autoComplete="off"
            required
          />
        </SettingRow>
        <SettingRow
          border={false}
          label={t("Target language")}
          name="targetLanguage"
          description={t("The language that text is translated into.")}
        >
          <InputSelect
            options={languageOptions}
            value={targetLanguage}
            onChange={handleTargetLanguageChange}
            label={t("Target language")}
            labelHidden
          />
        </SettingRow>

        <ActionRow>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? `${t("Saving")}…` : t("Save")}
          </Button>
        </ActionRow>
      </form>
    </Scene>
  );
}

export default observer(Translation);
