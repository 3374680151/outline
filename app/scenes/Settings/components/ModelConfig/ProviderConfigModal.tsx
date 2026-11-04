import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled, { keyframes } from "styled-components";
import { s } from "@shared/styles";
import { aiVendorTemplates } from "@shared/aiVendorTemplates";
import type { ModelProviderProtocol } from "@shared/aiVendorTemplates";
import Button from "~/components/Button";
import Input from "~/components/Input";
import { InputSelect } from "~/components/InputSelect";
import { client } from "~/utils/ApiClient";
import { ModelSyncDialog } from "./ModelSyncDialog";
import type { ModelProviderInfo } from "./types";

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; text: string }
  | { status: "failed"; error: string };

const PROTOCOL_OPTIONS: {
  value: ModelProviderProtocol;
  labelKey: string;
  descKey: string;
}[] = [
  {
    value: "openai",
    labelKey: "OpenAI Compatible",
    descKey: "/v1/chat/completions, works with most gateways",
  },
  {
    value: "anthropic",
    labelKey: "Anthropic",
    descKey: "Claude official /v1/messages protocol",
  },
  {
    value: "gemini",
    labelKey: "Gemini",
    descKey: "Google AI generateContent protocol",
  },
];

type ModeTab = "official" | "custom";

type StepKey = "access" | "basic" | "key" | "models" | "advanced";

const STEPS: {
  key: StepKey;
  labelKey: string;
  section: string;
}[] = [
  {
    key: "access",
    labelKey: "Access method",
    section: "access",
  },
  {
    key: "basic",
    labelKey: "Basics",
    section: "basic",
  },
  {
    key: "key",
    labelKey: "Credentials",
    section: "key",
  },
  {
    key: "models",
    labelKey: "Models & default",
    section: "models",
  },
  {
    key: "advanced",
    labelKey: "Advanced",
    section: "advanced",
  },
];

/**
 * The create/edit provider form shown in a modal, ported from the
 * FluentRead-Go provider modal: a step rail on the left, the access-method
 * tabs (official vendor catalog vs custom protocol), inline validation, and
 * a connection test that uses the stored key when editing without a new one.
 *
 * @param props The modal props.
 * @param props.row The provider being edited, omitted when creating.
 * @param props.onSaved Called with the saved row after a successful save.
 * @param props.onClose Closes the modal.
 */
export function ProviderConfigModal({
  row,
  onSaved,
  onClose,
}: {
  row?: ModelProviderInfo;
  onSaved: (row: ModelProviderInfo) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editing = !!row;

  const [modeTab, setModeTab] = React.useState<ModeTab>(
    editing ? (row!.vendor ? "official" : "custom") : "official"
  );
  const [vendorId, setVendorId] = React.useState(row?.vendor ?? "");
  const [customProtocol, setCustomProtocol] = React.useState(
    (row?.protocol as ModelProviderProtocol) ?? "openai"
  );
  const [name, setName] = React.useState(row?.name ?? "");
  const [baseUrl, setBaseUrl] = React.useState(row?.baseUrl ?? "");
  const [apiKey, setApiKey] = React.useState("");
  const [defaultModel, setDefaultModel] = React.useState(row?.model ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(
    new Set(row ? row.models.filter((model) => model.enabled).map((model) => model.id) : [])
  );
  const [nameErr, setNameErr] = React.useState("");
  const [baseUrlErr, setBaseUrlErr] = React.useState("");
  const [formMsg, setFormMsg] = React.useState<string | null>(null);
  const [test, setTest] = React.useState<TestState>({
    status: "idle",
  });
  const [saving, setSaving] = React.useState(false);
  const [fetchOpen, setFetchOpen] = React.useState(false);
  const mainRef = React.useRef<HTMLDivElement | null>(null);

  const selectedVendor = React.useMemo(
    () => aiVendorTemplates.find((template) => template.vendor === vendorId) ?? null,
    [vendorId]
  );
  const protocol: ModelProviderProtocol =
    modeTab === "official"
      ? (selectedVendor?.protocol ?? ((row?.protocol as ModelProviderProtocol) ?? "openai"))
      : customProtocol;

  const pickVendor = (vendor: string) => {
    const template = aiVendorTemplates.find((entry) => entry.vendor === vendor);

    if (!template || vendorId === vendor) {
      return;
    }

    setVendorId(vendor);
    setName((current) => (editing ? current : template.name));
    setBaseUrl((current) => (editing ? current : template.baseUrl));
    setFormMsg(null);
    setTest({
      status: "idle",
    });

    // Switching vendors invalidates the models fetched from the previous
    // endpoint; never prefill the default model.
    if (!editing) {
      setSelected(new Set());
      setDefaultModel("");
    }
  };

  const applyMode = (tab: ModeTab) => {
    setModeTab(tab);
    setFormMsg(null);
    setTest({
      status: "idle",
    });

    if (tab === "official") {
      setVendorId(editing && row?.vendor ? row.vendor : "");
    } else {
      setVendorId("");
      setCustomProtocol((row?.protocol as ModelProviderProtocol) ?? "openai");
    }
  };

  const useSavedKeyTest = editing && apiKey.trim() === "";

  const runTest = async () => {
    if (test.status === "running") {
      return;
    }

    const model =
      defaultModel.trim() || [...selected][0] || "";

    if (!model) {
      const msg = t(
        "Pick a default model or fetch and check models before testing"
      );
      setFormMsg(msg);
      toast.error(msg);
      return;
    }

    if (!baseUrl.trim()) {
      const msg = t("Fill in the API endpoint before testing");
      setFormMsg(msg);
      toast.error(msg);
      return;
    }

    setTest({
      status: "running",
    });
    setFormMsg(null);

    try {
      const res = await client.post("/aiModelProviders.test", {
        ...(useSavedKeyTest && row ? { id: row.id } : {}),
        ...(useSavedKeyTest
          ? {}
          : {
              protocol,
              baseUrl: baseUrl.trim(),
            }),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        model,
      });
      const result = res.data as {
        ok: boolean;
        latencyMs: number;
        error?: string;
      };

      if (result.ok) {
        const hint =
          useSavedKeyTest ? row?.keyHint : apiKey.trim().slice(-4);
        setTest({
          status: "ok",
          text: `✓ ${model} · ${result.latencyMs}ms${
            hint ? ` · key ••••${hint}` : ""
          }`,
        });
      } else {
        setTest({
          status: "failed",
          error: result.error ?? t("Connection test failed"),
        });
      }
    } catch (err) {
      setTest({
        status: "failed",
        error: err instanceof Error ? err.message : t("Connection test failed"),
      });
    }
  };

  const modelsChanged = React.useMemo(() => {
    if (!row) {
      return false;
    }

    const initial = row.models
      .filter((model) => model.enabled)
      .map((model) => model.id)
      .sort();
    const now = [...selected].sort();
    return (
      now.length !== initial.length ||
      now.some((id, index) => id !== initial[index])
    );
  }, [row, selected]);

  const defaultOptions = React.useMemo(() => {
    const set = new Set(selected);

    if (defaultModel) {
      set.add(defaultModel);
    }

    return [...set].sort().map((id) => ({
      type: "item" as const,
      label: id,
      value: id,
    }));
  }, [selected, defaultModel]);

  const save = async () => {
    if (saving) {
      return;
    }

    setFormMsg(null);
    const nextNameErr = name.trim() ? "" : t("Name is required");
    const nextBaseUrlErr = /^https?:\/\//.test(baseUrl.trim())
      ? ""
      : t("Base URL must be an http(s) URL");
    setNameErr(nextNameErr);
    setBaseUrlErr(nextBaseUrlErr);

    if (nextNameErr || nextBaseUrlErr) {
      mainRef.current?.scrollTo({
        top: 0,
      });
      return;
    }

    setSaving(true);

    try {
      const saveVendor = modeTab === "official" ? vendorId : "";

      if (!editing) {
        const res = await client.post("/aiModelProviders.create", {
          name: name.trim(),
          vendor: saveVendor || undefined,
          protocol,
          baseUrl: baseUrl.trim(),
          model: defaultModel.trim() || undefined,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        });
        const created = res.data.provider as ModelProviderInfo;

        if (selected.size > 0) {
          const synced = await client.post("/aiModelProviders.setModels", {
            id: created.id,
            models: [...selected],
          });
          onSaved(synced.data.provider as ModelProviderInfo);
        } else {
          onSaved(created);
        }
      } else {
        const res = await client.post("/aiModelProviders.update", {
          id: row!.id,
          name: name.trim(),
          vendor: saveVendor,
          protocol,
          baseUrl: baseUrl.trim(),
          model: defaultModel,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        });
        let view = res.data.provider as ModelProviderInfo;

        if (modelsChanged) {
          const synced = await client.post("/aiModelProviders.setModels", {
            id: row!.id,
            models: [...selected],
          });
          view = synced.data.provider as ModelProviderInfo;
        }

        onSaved(view);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("Could not save the configuration");
      setFormMsg(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const scrollToStep = (section: string) => {
    document
      .getElementById(`pm-sec-${section}`)
      ?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
  };

  const done: Record<StepKey, boolean> = {
    access: editing || (modeTab === "custom" ? true : !!vendorId),
    basic: name.trim() !== "",
    key: !!apiKey.trim() || !!row?.hasApiKey,
    models: selected.size > 0,
    advanced: false,
  };

  React.useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeydown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeydown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <Overlay
      role="dialog"
      aria-modal
      aria-label={editing ? t("Edit provider") : t("Create provider")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <Panel>
        <PanelHead>
          <PanelHeadMain>
            <PanelTitle>
              {editing
                ? t("Edit provider · {{name}}", { name: row!.name })
                : t("Create provider")}
            </PanelTitle>
            <PanelSub>
              {editing
                ? t("Change the endpoint, key, and models; changes apply immediately.")
                : t("Add a new provider by providing the necessary information.")}
            </PanelSub>
          </PanelHeadMain>
          <PanelClose type="button" aria-label={t("Close")} onClick={onClose}>
            ✕
          </PanelClose>
        </PanelHead>
        <Body>
        <Mid>
      <Rail>
        {STEPS.map((step) => (
          <Step
            key={step.key}
            type="button"
            onClick={() => scrollToStep(step.section)}
          >
            <StepRing $done={done[step.key]}>
              {done[step.key] ? "✓" : ""}
            </StepRing>
            <StepLabel>{t(step.labelKey)}</StepLabel>
          </Step>
        ))}
      </Rail>

      <Main ref={mainRef}>
        {formMsg && (
          <FormMsg role="alert">{formMsg}</FormMsg>
        )}

        <Section id="pm-sec-access">
          <SecTitle>{t("Access method")}</SecTitle>
          <SecSub>
            {t("Official vendors only need a key; custom connects any compatible endpoint")}
          </SecSub>

          <ModeTabs>
            <ModeTabButton
              type="button"
              role="tab"
              aria-selected={modeTab === "official"}
              $on={modeTab === "official"}
              onClick={() => applyMode("official")}
            >
              <ModeTabTitle>{t("Official vendors")}</ModeTabTitle>
              <ModeTabSub>{t("Pick from the catalog, just add a key")}</ModeTabSub>
            </ModeTabButton>
            <ModeTabButton
              type="button"
              role="tab"
              aria-selected={modeTab === "custom"}
              $on={modeTab === "custom"}
              onClick={() => applyMode("custom")}
            >
              <ModeTabTitle>{t("Custom access")}</ModeTabTitle>
              <ModeTabSub>{t("Choose a protocol, connect any endpoint")}</ModeTabSub>
            </ModeTabButton>
          </ModeTabs>

          {modeTab === "official" ? (
            <VendorList role="listbox" aria-label={t("Select a vendor")}>
              {aiVendorTemplates.map((template) => (
                <VendorRow
                  key={template.vendor}
                  type="button"
                  role="option"
                  aria-selected={vendorId === template.vendor}
                  $on={vendorId === template.vendor}
                  onClick={() => pickVendor(template.vendor)}
                >
                  <VendorLogo aria-hidden>
                    {template.name.slice(0, 1).toUpperCase()}
                  </VendorLogo>
                  <VendorMain>
                    <VendorName>
                      {template.name}
                      <ProtocolChip>{t(template.protocol === "openai" ? "OpenAI Compatible" : template.protocol)}</ProtocolChip>
                    </VendorName>
                    <VendorDesc>{template.baseUrl}</VendorDesc>
                  </VendorMain>
                  {vendorId === template.vendor && <VendorCheck>✓</VendorCheck>}
                </VendorRow>
              ))}
            </VendorList>
          ) : (
            <Field>
              <Label>{t("Protocol")}</Label>
              <ProtocolGrid role="radiogroup" aria-label={t("Protocol")}>
                {PROTOCOL_OPTIONS.map((option) => (
                  <ProtocolRow
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={customProtocol === option.value}
                    $on={customProtocol === option.value}
                    onClick={() => setCustomProtocol(option.value)}
                  >
                    <ProtocolLabel>{t(option.labelKey)}</ProtocolLabel>
                    <ProtocolDesc>{t(option.descKey)}</ProtocolDesc>
                  </ProtocolRow>
                ))}
              </ProtocolGrid>
            </Field>
          )}
        </Section>

        <Section id="pm-sec-basic">
          <SecTitle>{t("Basics")}</SecTitle>
          <SecSub>{t("Name and API endpoint; official vendors prefill both")}</SecSub>
          <Grid2>
            <Field>
              <Label>{t("Name")}</Label>
              <Input
                value={name}
                placeholder={t("Shown in the list")}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              {nameErr && <FieldError>{nameErr}</FieldError>}
            </Field>
            <Field>
              <Label>{t("API endpoint")}</Label>
              <Input
                value={baseUrl}
                placeholder="https://api.example.com/v1"
                onChange={(event) => setBaseUrl(event.currentTarget.value)}
              />
              {baseUrlErr && <FieldError>{baseUrlErr}</FieldError>}
            </Field>
          </Grid2>
          {modeTab === "official" && !vendorId && (
            <Help>{t("Pick a vendor above and the name and endpoint fill themselves.")}</Help>
          )}
        </Section>

        <Section id="pm-sec-key">
          <SecTitle>{t("Credentials")}</SecTitle>
          <SecSub>{t("API keys are stored server-side and shown masked")}</SecSub>
          <Field>
            <Label>{t("API key")}</Label>
            <Input
              type="password"
              value={apiKey}
              placeholder={
                row?.keyHint ? `•••• ${row.keyHint}` : t("Enter the API key")
              }
              onChange={(event) => setApiKey(event.currentTarget.value)}
              autoComplete="new-password"
            />
            {kindOf(modeTab, vendorId) === "local" && (
              <Help>{t("Local services usually need no key; leave it empty.")}</Help>
            )}
          </Field>
        </Section>

        <Section id="pm-sec-models">
          <SecTitle>{t("Models & default")}</SecTitle>
          <SecSub>{t("Fetch the upstream list and check the models to enable")}</SecSub>
          <FetchRow>
            <Button
              type="button"
              neutral
              disabled={!editing && !baseUrl.trim()}
              onClick={() => setFetchOpen(true)}
            >
              {t("Fetch models")}
            </Button>
            <FetchSummary>
              {t("{{count}} selected", { count: selected.size })}
              {!editing && selected.size === 0
                ? t(" (none checked = fetch all after saving)")
                : ""}
            </FetchSummary>
          </FetchRow>
          <Field>
            <Label>{t("Default model")}</Label>
            <InputSelect
              label={t("Default model")}
              options={
                defaultOptions.length
                  ? defaultOptions
                  : [
                      {
                        type: "heading" as const,
                        label: t("Fetch models first"),
                      },
                    ]
              }
              value={defaultModel}
              onChange={(value: string) => setDefaultModel(value)}
            />
          </Field>
        </Section>

        <Section id="pm-sec-advanced">
          <SecTitle>{t("Advanced")}</SecTitle>
          <SecSub>{t("Optional; the defaults are fine")}</SecSub>
          <KvRow>
            <Label>{t("Protocol")}</Label>
            <ProtocolChip>{t(protocol === "openai" ? "OpenAI Compatible" : protocol)}</ProtocolChip>
          </KvRow>
        </Section>
      </Main>
        </Mid>

      <Footer>
        <TestResult>
          {test.status === "ok" && <TestOk>{test.text}</TestOk>}
          {test.status === "failed" && <TestFail>{test.error}</TestFail>}
        </TestResult>
        <FooterSpacer />
        <Button
          type="button"
          neutral
          onClick={runTest}
          disabled={test.status === "running" || saving}
        >
          {test.status === "running"
            ? t("Testing…")
            : useSavedKeyTest
              ? t("Test with saved key")
              : t("Test connection")}
        </Button>
        <Button type="button" neutral onClick={onClose} disabled={saving}>
          {t("Cancel")}
        </Button>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? `${t("Saving")}…` : t("Save")}
        </Button>
      </Footer>
        </Body>
      </Panel>

      {fetchOpen && (
        <ModelSyncDialog
          name={name || t("New provider")}
          providerId={editing ? row!.id : undefined}
          form={
            editing
              ? undefined
              : {
                  protocol,
                  baseUrl: baseUrl.trim(),
                  apiKey: apiKey.trim(),
                }
          }
          existing={row?.models ?? []}
          onApply={(ids) => {
            setSelected(new Set(ids));
            setFetchOpen(false);
          }}
          onClose={() => setFetchOpen(false)}
        />
      )}
    </Overlay>
  );
}

/** Resolves the catalog kind used for the "no key needed" hint. */
function kindOf(modeTab: ModeTab, vendorId: string): string | undefined {
  if (modeTab !== "official") {
    return undefined;
  }

  return aiVendorTemplates.find((template) => template.vendor === vendorId)?.kind;
}

const fadeIn = keyframes`
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(10, 12, 16, 0.46);
  overscroll-behavior: contain;
`;

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  width: 880px;
  max-width: 100%;
  max-height: min(680px, 94vh);
  background: ${s("background")};
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  animation: ${fadeIn} 150ms ease-out;
`;

const PanelHead = styled.header`
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 16px 16px 12px 20px;
`;

const PanelHeadMain = styled.div`
  flex: 1;
  min-width: 0;
`;

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: ${s("text")};
`;

const PanelSub = styled.p`
  margin: 2px 0 0;
  font-size: 12.5px;
  color: ${s("textTertiary")};
`;

const PanelClose = styled.button`
  flex: none;
  border: none;
  background: none;
  cursor: pointer;
  color: ${s("textSecondary")};
  font-size: 14px;
  padding: 2px 6px;

  &:hover {
    color: ${s("text")};
  }
`;

const Body = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  padding: 0 20px 16px;
  overflow: hidden;
`;

const Mid = styled.div`
  display: flex;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`;

const Rail = styled.aside`
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 4px;
  width: 172px;

  @media (max-width: 720px) {
    display: none;
  }
`;

const Step = styled.button`
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 4px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: pointer;
  color: ${s("textSecondary")};

  &:hover {
    color: ${s("text")};
  }
`;

const StepRing = styled.span<{ $done?: boolean }>`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid ${s("divider")};
  font-size: 11px;
  color: #fff;
  ${(props) =>
    props.$done
      ? `background: ${s("accent")}; border-color: ${s("accent")};`
      : ""}
`;

const StepLabel = styled.span`
  font-size: 13px;
`;

const Main = styled.div`
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 4px;
`;

const FormMsg = styled.div`
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: ${s("danger")}1f;
  color: ${s("danger")};
  font-size: 13px;
`;

const Section = styled.section`
  padding: 16px 0;

  & + & {
    border-top: 1px solid ${s("divider")};
  }
`;

const SecTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
`;

const SecSub = styled.p`
  margin: 2px 0 10px;
  font-size: 12.5px;
  color: ${s("textTertiary")};
`;

const ModeTabs = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
`;

const ModeTabButton = styled.button<{ $on?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid ${(props) => (props.$on ? s("accent") : s("divider"))};
  border-radius: 8px;
  background: ${(props) => (props.$on ? `${s("accent")}0f` : "transparent")};
  cursor: pointer;
  text-align: left;
`;

const ModeTabTitle = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${s("text")};
`;

const ModeTabSub = styled.span`
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const VendorList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  margin-top: 10px;
  overflow-y: auto;
`;

const VendorRow = styled.button<{ $on?: boolean }>`
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid ${(props) => (props.$on ? s("accent") : "transparent")};
  border-radius: 8px;
  background: ${(props) => (props.$on ? `${s("accent")}0f` : "transparent")};
  cursor: pointer;
  text-align: left;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const VendorLogo = styled.span`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: ${s("backgroundTertiary")};
  color: ${s("textSecondary")};
  font-size: 12px;
  font-weight: 600;
`;

const VendorMain = styled.span`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const VendorName = styled.span`
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  font-weight: 600;
  color: ${s("text")};
`;

const VendorDesc = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: ${s("textTertiary")};
`;

const VendorCheck = styled.span`
  flex: none;
  color: ${s("accent")};
  font-weight: 700;
`;

const ProtocolChip = styled.span`
  padding: 1px 6px;
  border-radius: 4px;
  background: ${s("backgroundSecondary")};
  color: ${s("textSecondary")};
  font-size: 11px;
  font-weight: 500;
`;

const ProtocolGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
`;

const ProtocolRow = styled.button<{ $on?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid ${(props) => (props.$on ? s("accent") : s("divider"))};
  border-radius: 8px;
  background: ${(props) => (props.$on ? `${s("accent")}0f` : "transparent")};
  cursor: pointer;
  text-align: left;
`;

const ProtocolLabel = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${s("text")};
`;

const ProtocolDesc = styled.span`
  font-size: 11.5px;
  color: ${s("textTertiary")};
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
`;

const Label = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${s("text")};
`;

const FieldError = styled.span`
  font-size: 12px;
  color: ${s("danger")};
`;

const Grid2 = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`;

const Help = styled.p`
  margin: 6px 0 0;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const FetchRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
`;

const FetchSummary = styled.span`
  font-size: 12.5px;
  color: ${s("textTertiary")};
`;

const KvRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`;

const Footer = styled.footer`
  display: flex;
  flex: none;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid ${s("divider")};
`;

const FooterSpacer = styled.span`
  flex: 1;
`;

const TestResult = styled.span`
  font-size: 12.5px;
`;

const TestOk = styled.span`
  color: ${s("noticeSuccessText")};
`;

const TestFail = styled.span`
  color: ${s("danger")};
`;
