import { observer } from "mobx-react";
import { CheckmarkIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import Input from "~/components/Input";
import { InputSelect } from "~/components/InputSelect";
import {
  type ModelProviderInfo,
  type ProviderModelInfo,
  kindOfRow,
  usableModelOf,
} from "./types";

/**
 * The right pane of the model configuration page: provider detail with the
 * credentials section, the two-column model checklist (checking saves
 * immediately), the default model picker with manual entry, apply-to-feature
 * links, and the two-step delete. Renders an empty state when no provider is
 * selected.
 *
 * @param props The pane props.
 * @param props.row The selected provider, or null for the empty state.
 * @param props.hasProviders Whether any provider exists at all.
 * @param props.testing Whether the test call for this provider is running.
 * @param props.testResult The last inline test result, when shown.
 * @param props.translationBound Whether this provider is the bound
 *   translation model.
 * @param props.proofreadBound Whether this provider is the bound proofread
 *   model.
 * @param props.onEdit Opens the edit modal.
 * @param props.onTest Runs the connection test.
 * @param props.onSync Opens the upstream sync dialog.
 * @param props.onCheckModel Toggles one model.
 * @param props.onDefault Sets (or clears with "") the default model.
 * @param props.onAddModel Manually adds a model.
 * @param props.onDelete Deletes the provider.
 * @param props.onApplyTo Binds this provider to a feature.
 */
export const ProviderDetailPane = observer(function ProviderDetailPane({
  row,
  hasProviders,
  testing,
  testResult,
  translationBound,
  proofreadBound,
  onEdit,
  onTest,
  onSync,
  onCheckModel,
  onDefault,
  onAddModel,
  onDelete,
  onApplyTo,
}: {
  row: ModelProviderInfo | null;
  hasProviders: boolean;
  testing: boolean;
  testResult: { ok: boolean; text: string } | null;
  translationBound: boolean;
  proofreadBound: boolean;
  onEdit: (row: ModelProviderInfo) => void;
  onTest: (row: ModelProviderInfo) => void;
  onSync: (row: ModelProviderInfo) => void;
  onCheckModel: (
    row: ModelProviderInfo,
    modelId: string,
    checked: boolean
  ) => void;
  onDefault: (row: ModelProviderInfo, modelId: string) => void;
  onAddModel: (row: ModelProviderInfo, model: string) => void;
  onDelete: (row: ModelProviderInfo) => void;
  onApplyTo: (row: ModelProviderInfo, feature: "translation" | "proofread") => void;
}) {
  const { t } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [manualModel, setManualModel] = React.useState("");

  // Reset the transient state when switching providers.
  React.useEffect(() => {
    setConfirmingDelete(false);
    setManualModel("");
  }, [row?.id]);

  if (!row) {
    return (
      <Pane>
        <Empty>
          {hasProviders
            ? t("Select a provider on the left to see its details")
            : t("No providers yet — add the first one on the left.")}
        </Empty>
      </Pane>
    );
  }

  const enabledModels = row.models.filter((model) => model.enabled);
  const defaultOptions = enabledModels.map((model) => ({
    type: "item" as const,
    label: model.id,
    value: model.id,
  }));
  const applyModelId = usableModelOf(row);
  const localKeyless = kindOfRow(row) === "local" && !row.hasApiKey;

  const handleDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }

    setConfirmingDelete(false);
    onDelete(row);
  };

  const submitManual = () => {
    const name = manualModel.trim();

    if (!name) {
      return;
    }

    onAddModel(row, name);
    setManualModel("");
  };

  const handleCheck = (model: ProviderModelInfo) => {
    onCheckModel(row, model.id, !model.enabled);
  };

  return (
    <Pane>
      <Header>
        <Logo aria-hidden>{row.name.slice(0, 1).toUpperCase()}</Logo>
        <HeadMain>
          <HeadTitle>
            <Name>{row.name}</Name>
            {row.vendor && <VendorBadge>{row.vendor}</VendorBadge>}
            <ProtocolBadge>{row.protocol}</ProtocolBadge>
            <StatusBadge $on={row.enabled}>
              {row.enabled ? t("Enabled") : t("Disabled")}
            </StatusBadge>
          </HeadTitle>
          <HeadSub>{row.baseUrl}</HeadSub>
        </HeadMain>
        <HeadActions>
          {testing ? (
            <TestLink $loading>{t("Testing…")}</TestLink>
          ) : (
            <TestLink
              as="button"
              type="button"
              onClick={() => onTest(row)}
            >
              {t("Test service")}
            </TestLink>
          )}
          <Button type="button" neutral onClick={() => onEdit(row)}>
            {t("Edit")}
          </Button>
        </HeadActions>
      </Header>

      {testResult && (
        <TestResultLine $ok={testResult.ok}>{testResult.text}</TestResultLine>
      )}

      <Section>
        <KeyRow>
          <KvLabel>{t("API key")}</KvLabel>
          {row.hasApiKey ? (
            <KvValue>
              ••••{row.keyHint}
            </KvValue>
          ) : localKeyless ? (
            <KvValue $faint>{t("No key required")}</KvValue>
          ) : (
            <KeyFillButton type="button" onClick={() => onEdit(row)}>
              {t("Key missing — click to fill")}
            </KeyFillButton>
          )}
        </KeyRow>
        <KeyRow>
          <KvLabel>{t("API endpoint")}</KvLabel>
          <KvValue $mono>{row.baseUrl}</KvValue>
        </KeyRow>
      </Section>

      <Section>
        <ModelsHead>
          <SectionTitle>{t("Models")}</SectionTitle>
          <ModelsCount>
            {t("{{enabled}} / {{total}} enabled", {
              enabled: enabledModels.length,
              total: row.models.length,
            })}
          </ModelsCount>
          <Button type="button" neutral onClick={() => onSync(row)}>
            {t("Update models")}
          </Button>
        </ModelsHead>

        {row.models.length > 0 ? (
          <ModelGrid>
            {row.models.map((model) => (
              <ModelRow
                key={model.id}
                type="button"
                role="checkbox"
                aria-checked={model.enabled}
                onClick={() => handleCheck(model)}
              >
                <ModelCheckbox $checked={model.enabled}>
                  {model.enabled && <CheckmarkIcon size={12} />}
                </ModelCheckbox>
                <ModelName>{model.id}</ModelName>
              </ModelRow>
            ))}
          </ModelGrid>
        ) : (
          <ModelsEmpty>
            {t("No models yet — click “Update models” to fetch them from the provider.")}
          </ModelsEmpty>
        )}

        <ToolsRow>
          <ToolsLabel>{t("Default model")}</ToolsLabel>
          <InputSelect
            label={t("Default model")}
            labelHidden
            options={
              defaultOptions.length
                ? defaultOptions
                : [
                    {
                      type: "heading" as const,
                      label: t("No enabled models"),
                    },
                  ]
            }
            value={row.model ?? ""}
            onChange={(value: string) => onDefault(row, value)}
          />
          <ManualInput
            value={manualModel}
            placeholder={t("Type a model id to add")}
            onChange={(event) => setManualModel(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitManual();
              }
            }}
          />
          <Button
            type="button"
            neutral
            disabled={!manualModel.trim()}
            onClick={submitManual}
          >
            {t("Add")}
          </Button>
        </ToolsRow>

        <HelpLine>
          {t("Checked models are usable in this workspace; unchecking only disables them.")}
          {applyModelId && (
            <>
              <ApplyLink
                type="button"
                onClick={() => onApplyTo(row, "translation")}
                title={translationBound ? t("Currently bound") : undefined}
              >
                {translationBound
                  ? `✓ ${t("Apply to translation")}`
                  : t("Apply to translation")}
              </ApplyLink>
              <ApplyLink
                type="button"
                onClick={() => onApplyTo(row, "proofread")}
                title={proofreadBound ? t("Currently bound") : undefined}
              >
                {proofreadBound
                  ? `✓ ${t("Apply to proofreading")}`
                  : t("Apply to proofreading")}
              </ApplyLink>
            </>
          )}
        </HelpLine>
      </Section>

      <Footer>
        <DeleteButton
          type="button"
          $confirm={confirmingDelete}
          onClick={handleDelete}
        >
          {confirmingDelete ? t("Confirm delete?") : t("Delete provider")}
        </DeleteButton>
      </Footer>
    </Pane>
  );
});

const Pane = styled.section`
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  padding: 16px 20px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
`;

const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  font-size: 13px;
  color: ${s("textTertiary")};
`;

const Header = styled.header`
  display: flex;
  gap: 12px;
  align-items: flex-start;
`;

const Logo = styled.span`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: ${s("backgroundSecondary")};
  color: ${s("textSecondary")};
  font-size: 16px;
  font-weight: 600;
`;

const HeadMain = styled.div`
  flex: 1;
  min-width: 0;
`;

const HeadTitle = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;

const Name = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: ${s("text")};
`;

const Badge = styled.span`
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
`;

const VendorBadge = styled(Badge)`
  background: ${s("accent")}1f;
  color: ${s("accent")};
  text-transform: capitalize;
`;

const ProtocolBadge = styled(Badge)`
  background: ${s("backgroundSecondary")};
  color: ${s("textSecondary")};
`;

const StatusBadge = styled(Badge)<{ $on?: boolean }>`
  background: ${(props) => (props.$on ? `${s("noticeSuccessText")}1f` : s("backgroundSecondary"))};
  color: ${(props) => (props.$on ? s("noticeSuccessText") : s("textTertiary"))};
`;

const HeadSub = styled.div`
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const HeadActions = styled.div`
  display: flex;
  flex: none;
  gap: 12px;
  align-items: center;
`;

const TestLink = styled.span<{ $loading?: boolean }>`
  font-size: 13px;
  color: ${s("accent")};
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;

  ${(props) =>
    props.$loading
      ? `
        color: ${s("textTertiary")};
        text-decoration: none;
        cursor: default;
      `
      : ""}
`;

const TestResultLine = styled.div<{ $ok?: boolean }>`
  margin-top: 10px;
  font-size: 12.5px;
  color: ${(props) => (props.$ok ? s("noticeSuccessText") : s("danger"))};
`;

const Section = styled.section`
  padding: 16px 0;
  border-top: 1px solid ${s("divider")};

  &:first-of-type {
    margin-top: 16px;
  }
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: ${s("text")};
`;

const KeyRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: baseline;
  min-width: 0;

  & + & {
    margin-top: 8px;
  }
`;

const KvLabel = styled.span`
  flex: none;
  width: 96px;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const KvValue = styled.span<{ $faint?: boolean; $mono?: boolean }>`
  font-size: 13px;
  color: ${(props) => (props.$faint ? s("textTertiary") : s("text"))};
  ${(props) => (props.$mono ? "font-family: monospace; font-size: 12px;" : "")}
`;

const KeyFillButton = styled.button`
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: ${s("noticeWarningText")};

  &:hover {
    text-decoration: underline;
  }
`;

const ModelsHead = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const ModelsCount = styled.span`
  flex: 1;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const ModelGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
  margin-top: 12px;
`;

const ModelRow = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  text-align: left;
  transition: background-color 150ms ease-in-out;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const ModelCheckbox = styled.span<{ $checked?: boolean }>`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px solid ${(props) => (props.$checked ? "transparent" : s("divider"))};
  border-radius: 4px;
  background: ${(props) => (props.$checked ? s("accent") : "transparent")};
  color: #fff;
`;

const ModelName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: monospace;
  font-size: 13px;
  color: ${s("text")};
`;

const ModelsEmpty = styled.div`
  padding: 12px 0;
  font-size: 13px;
  color: ${s("textTertiary")};
`;

const ToolsRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 12px;

  > div:nth-child(2) {
    width: 200px;
    flex-shrink: 0;
  }

  > div:nth-child(3) {
    flex: 1;
    min-width: 0;
  }
`;

const ToolsLabel = styled.span`
  flex: none;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const ManualInput = styled(Input)``;

const HelpLine = styled.p`
  margin: 8px 0 0;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const ApplyLink = styled.button`
  margin-left: 8px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: ${s("accent")};

  &:hover {
    text-decoration: underline;
  }
`;

const Footer = styled.footer`
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid ${s("divider")};
`;

const DeleteButton = styled.button<{ $confirm?: boolean }>`
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: ${s("danger")};
  ${(props) => (props.$confirm ? "font-weight: 600;" : "")}
`;
