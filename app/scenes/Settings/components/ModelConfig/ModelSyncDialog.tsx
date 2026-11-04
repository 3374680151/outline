import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import type { ModelProviderProtocol } from "@shared/aiVendorTemplates";
import Button from "~/components/Button";
import { client } from "~/utils/ApiClient";
import type { ProviderModelInfo } from "./types";

/** Credentials for testing an unsaved provider (used once, then discarded). */
export interface SyncFormCredentials {
  protocol: ModelProviderProtocol;
  baseUrl: string;
  apiKey: string;
}

/**
 * The upstream model diff dialog, ported from the FluentRead-Go sync dialog:
 * it fetches the upstream model list (via the stored key when a provider id
 * is given, otherwise with one-shot form credentials), diffs it against the
 * locally known models, and lets the caller apply the resulting enabled set.
 * Newly appeared models default to checked; locally unknown upstream models
 * are listed as removed.
 *
 * @param props The dialog props.
 * @param props.name The provider display name, shown in the header.
 * @param props.providerId The provider id when it is already saved.
 * @param props.form Form credentials when the provider is not saved yet.
 * @param props.existing The locally known models of the provider.
 * @param props.onApply Called with the full enabled model id set to store.
 * @param props.onClose Closes the dialog.
 */
export function ModelSyncDialog({
  name,
  providerId,
  form,
  existing,
  onApply,
  onClose,
}: {
  name: string;
  providerId?: string;
  form?: SyncFormCredentials;
  existing: ProviderModelInfo[];
  onApply: (ids: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [addedIds, setAddedIds] = React.useState<string[]>([]);
  const [removedIds, setRemovedIds] = React.useState<string[]>([]);
  const [checkedNew, setCheckedNew] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const fetchUpstream = async () => {
      setLoading(true);
      setLoadError("");

      try {
        const res = await client.post("/aiModelProviders.models", {
          ...(providerId ? { id: providerId } : {}),
          ...(providerId
            ? {}
            : {
                protocol: form!.protocol,
                baseUrl: form!.baseUrl,
              }),
          ...(form?.apiKey ? { apiKey: form.apiKey } : {}),
        });
        const data = res.data as {
          models: string[];
          error?: string;
        };

        if (data.error) {
          setLoadError(data.error);
          return;
        }

        const known = new Set(existing.map((model) => model.id));
        const upstream = new Set(data.models);
        const added = data.models.filter((id) => !known.has(id));
        const removed = existing
          .filter((model) => !upstream.has(model.id))
          .map((model) => model.id);

        setAddedIds(added);
        setRemovedIds(removed);
        setCheckedNew(new Set(added));
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : t("Failed to fetch the upstream model list, try again later")
        );
      } finally {
        setLoading(false);
      }
    };

    void fetchUpstream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasDiff = addedIds.length > 0 || removedIds.length > 0;

  const toggleNew = (id: string, checked: boolean) => {
    const next = new Set(checkedNew);

    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }

    setCheckedNew(next);
  };

  const apply = () => {
    // Full enabled set = currently enabled minus removed plus checked new.
    const removed = new Set(removedIds);
    const keep = existing
      .filter((model) => model.enabled && !removed.has(model.id))
      .map((model) => model.id);
    onApply([...new Set([...keep, ...checkedNew])]);
  };

  return (
    <Overlay role="dialog" aria-modal aria-label={t("Update models")}>
      <Box>
        <Head>
          <HeadMain>
            <Title>{t("Update models")}</Title>
            <Sub>{t("Provider: {{name}}", { name })}</Sub>
          </HeadMain>
          <CloseButton type="button" aria-label={t("Close")} onClick={onClose}>
            ✕
          </CloseButton>
        </Head>

        <BodyBox>
          {loadError ? (
            <ErrorBox role="alert">
              {loadError}
              <Note>{t("Nothing has been changed.")}</Note>
            </ErrorBox>
          ) : loading ? (
            <Loading>{t("Fetching…")}</Loading>
          ) : hasDiff ? (
            <>
              {addedIds.length > 0 && (
                <Group>
                  <GroupHead $ok>
                    +{t("{{count}} new", { count: addedIds.length })}
                  </GroupHead>
                  {addedIds.map((id) => (
                    <DiffRow
                      key={id}
                      type="button"
                      role="checkbox"
                      aria-checked={checkedNew.has(id)}
                      onClick={() => toggleNew(id, !checkedNew.has(id))}
                    >
                      <CheckSquare $checked={checkedNew.has(id)}>
                        {checkedNew.has(id) ? "✓" : ""}
                      </CheckSquare>
                      <DiffName>{id}</DiffName>
                    </DiffRow>
                  ))}
                </Group>
              )}

              {removedIds.length > 0 && (
                <Group>
                  <GroupHead>
                    −{t("{{count}} removed upstream", { count: removedIds.length })}
                  </GroupHead>
                  {removedIds.map((id) => (
                    <DiffRow key={id} type="button" $off disabled>
                      <DiffName $off>{id}</DiffName>
                    </DiffRow>
                  ))}
                </Group>
              )}

              <Note>
                {t(
                  "Disabling does not delete history; unchecked new models stay unfetched until the next sync."
                )}
              </Note>
            </>
          ) : (
            <Clear>{t("Upstream and local models are already in sync.")}</Clear>
          )}
        </BodyBox>

        <Foot>
          {loadError || !hasDiff ? (
            <Button type="button" neutral onClick={onClose}>
              {t("Close")}
            </Button>
          ) : (
            <>
              <Button type="button" neutral onClick={onClose}>
                {t("Cancel")}
              </Button>
              <Button
                type="button"
                disabled={checkedNew.size === 0 && removedIds.length === 0}
                onClick={apply}
              >
                {t("Apply")}
              </Button>
            </>
          )}
        </Foot>
      </Box>
    </Overlay>
  );
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(10, 12, 16, 0.46);
`;

const Box = styled.div`
  display: flex;
  flex-direction: column;
  width: 420px;
  max-height: 70vh;
  background: ${s("background")};
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
  overflow: hidden;
`;

const Head = styled.header`
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 16px 16px 8px;
`;

const HeadMain = styled.div`
  flex: 1;
  min-width: 0;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: ${s("text")};
`;

const Sub = styled.p`
  margin: 2px 0 0;
  font-size: 12.5px;
  color: ${s("textTertiary")};
`;

const CloseButton = styled.button`
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

const BodyBox = styled.div`
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 8px 16px 16px;
`;

const Loading = styled.div`
  padding: 24px 0;
  font-size: 13px;
  color: ${s("textTertiary")};
  text-align: center;
`;

const ErrorBox = styled.div`
  padding: 12px;
  border-radius: 6px;
  background: ${s("danger")}1f;
  color: ${s("danger")};
  font-size: 13px;
`;

const Group = styled.section`
  & + & {
    margin-top: 12px;
  }
`;

const GroupHead = styled.h3<{ $ok?: boolean }>`
  margin: 0 0 4px;
  font-size: 12.5px;
  font-weight: 600;
  color: ${(props) => (props.$ok ? s("noticeSuccessText") : s("textTertiary"))};
`;

const DiffRow = styled.button<{ $off?: boolean }>`
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: none;
  cursor: ${(props) => (props.$off ? "default" : "pointer")};
  text-align: left;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const CheckSquare = styled.span<{ $checked?: boolean }>`
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
  font-size: 11px;
`;

const DiffName = styled.span<{ $off?: boolean }>`
  font-family: monospace;
  font-size: 13px;
  color: ${(props) => (props.$off ? s("textTertiary") : s("text"))};
  ${(props) => (props.$off ? "text-decoration: line-through;" : "")}
`;

const Note = styled.p`
  margin: 12px 0 0;
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const Clear = styled.div`
  padding: 24px 0;
  font-size: 13px;
  color: ${s("textTertiary")};
  text-align: center;
`;

const Foot = styled.footer`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid ${s("divider")};
`;
