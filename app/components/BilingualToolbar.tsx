import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import {
  CopyIcon,
  DownloadIcon,
  GlobeIcon,
  SettingsIcon,
  WarningIcon,
} from "outline-icons";
import { createAction, createActionWithChildren } from "~/actions";
import { ActiveDocumentSection } from "~/actions/sections";
import Button from "~/components/Button";
import { DialogTitle } from "~/components/DialogTitle";
import DocumentCopy from "~/components/DocumentExplorer/DocumentCopy";
import { DropdownMenu } from "~/components/Menu/DropdownMenu";
import { useBilingualPair } from "~/components/BilingualPairProvider";
import useStores from "~/hooks/useStores";
import type Document from "~/models/Document";
import BilingualStore from "~/stores/BilingualStore";
import {
  autoTranslateOnOpen,
  grammarCheckingEnabled,
  grammarLevel,
  setAutoTranslateOnOpen,
  setGrammarCheckingEnabled,
  setGrammarLevel,
  setTranslationTrigger,
  translationTrigger,
} from "~/utils/bilingual/prefs";

/**
 * The bilingual toolbar: translation progress, structure repair, the grammar
 * issue list, the save actions, and the per-user experience toggles. It
 * renders inside the primary pane's document header while the bilingual view
 * is active.
 */
export const BilingualToolbar = observer(function BilingualToolbar({
  document,
}: {
  document: Document;
}) {
  const { t } = useTranslation();
  const { pair, engine, grammarExtension } = useBilingualPair();
  const { dialogs, documents, policies } = useStores();
  const [saving, setSaving] = React.useState(false);

  const progress = engine?.progress ?? { translated: 0, total: 0 };
  const hasMismatch = engine?.hasMismatch ?? false;
  const issueCount = grammarExtension?.issueCount ?? 0;
  const checking = grammarExtension?.checking ?? false;

  // Recomputed on each render: the observable issueCount/checking above
  // trigger re-renders whenever the underlying matches change.
  const issues = grammarExtension?.listIssues() ?? [];

  const handleSaveMerged = React.useCallback(async () => {
    if (!pair || saving) {
      return;
    }

    setSaving(true);

    try {
      const source = documents.get(pair.sourceDocumentId);
      const created = await BilingualStore.saveMerged({
        pairId: pair.id,
        title: `${source?.title ?? t("Untitled")}（双语）`,
        collectionId: source?.collectionId ?? undefined,
        publish: false,
      });
      toast.success(t("Saved as a bilingual document"), {
        description: created.title,
      });
    } catch (_err) {
      toast.error(t("Could not save the bilingual document"));
    } finally {
      setSaving(false);
    }
  }, [pair, saving, documents, t]);

  const handlePromoteTarget = React.useCallback(async () => {
    if (!pair || saving) {
      return;
    }

    setSaving(true);

    try {
      const source = documents.get(pair.sourceDocumentId);
      const target = documents.get(pair.targetDocumentId);

      if (!target) {
        throw new Error("Mirror document unavailable");
      }

      const collectionId = source?.collectionId ?? undefined;

      if (collectionId) {
        await target.move({ collectionId });
      }

      if (source?.publishedAt) {
        await target.save(undefined, { publish: true });
      }

      toast.success(t("Mirror saved as a standalone document"));
    } catch (_err) {
      toast.error(t("Could not save the mirror document"));
    } finally {
      setSaving(false);
    }
  }, [pair, saving, documents, t]);

  const handleCopySource = React.useCallback(() => {
    dialogs.openModal({
      title: <DialogTitle title={t("Duplicate document")} model={document} />,
      content: (
        <DocumentCopy
          document={document}
          onSubmit={(response) => {
            dialogs.closeAllModals();
            toast.success(t("Copy created"));
            void response;
            void policies;
          }}
        />
      ),
    });
  }, [dialogs, document, t, policies]);

  const saveActions = React.useMemo(
    () => [
      createAction({
        name: t("Save as one bilingual document"),
        section: ActiveDocumentSection,
        icon: <DownloadIcon />,
        disabled: saving,
        perform: handleSaveMerged,
      }),
      createAction({
        name: t("Save the mirror as a standalone document"),
        section: ActiveDocumentSection,
        icon: <GlobeIcon />,
        disabled: saving,
        perform: handlePromoteTarget,
      }),
      createAction({
        name: t("Save the source as a copy"),
        section: ActiveDocumentSection,
        icon: <CopyIcon />,
        perform: handleCopySource,
      }),
    ],
    [saving, handleSaveMerged, handlePromoteTarget, handleCopySource, t]
  );

  const settingsActions = React.useMemo(() => {
    const trigger = translationTrigger();

    return [
      createActionWithChildren({
        name: t("Translation trigger"),
        section: ActiveDocumentSection,
        children: [
          createAction({
            name: t("Off"),
            section: ActiveDocumentSection,
            selected: trigger === "off",
            perform: () => setTranslationTrigger("off"),
          }),
          createAction({
            name: t("Dot next to selection"),
            section: ActiveDocumentSection,
            selected: trigger === "dot",
            perform: () => setTranslationTrigger("dot"),
          }),
          createAction({
            name: t("Hover words"),
            section: ActiveDocumentSection,
            selected: trigger === "hover",
            perform: () => setTranslationTrigger("hover"),
          }),
        ],
      }),
      createActionWithChildren({
        name: t("Grammar checking"),
        section: ActiveDocumentSection,
        children: [
          createAction({
            name: t("Enabled"),
            section: ActiveDocumentSection,
            selected: grammarCheckingEnabled(),
            perform: () => setGrammarCheckingEnabled(true),
          }),
          createAction({
            name: t("Disabled"),
            section: ActiveDocumentSection,
            selected: !grammarCheckingEnabled(),
            perform: () => setGrammarCheckingEnabled(false),
          }),
        ],
      }),
      createActionWithChildren({
        name: t("Grammar strictness"),
        section: ActiveDocumentSection,
        children: [
          createAction({
            name: t("Standard"),
            section: ActiveDocumentSection,
            selected: grammarLevel() === "default",
            perform: () => setGrammarLevel("default"),
          }),
          createAction({
            name: t("Strict (includes style)"),
            section: ActiveDocumentSection,
            selected: grammarLevel() === "picky",
            perform: () => setGrammarLevel("picky"),
          }),
        ],
      }),
      createActionWithChildren({
        name: t("Translate automatically on open"),
        section: ActiveDocumentSection,
        children: [
          createAction({
            name: t("Enabled"),
            section: ActiveDocumentSection,
            selected: autoTranslateOnOpen(),
            perform: () => setAutoTranslateOnOpen(true),
          }),
          createAction({
            name: t("Disabled"),
            section: ActiveDocumentSection,
            selected: !autoTranslateOnOpen(),
            perform: () => setAutoTranslateOnOpen(false),
          }),
        ],
      }),
    ];
  }, [t]);

  return (
    <Bar data-bilingual-toolbar>
      {progress.total > 0 && (
        <Chip title={t("Translated blocks")}>
          {progress.translated}/{progress.total}
        </Chip>
      )}
      {hasMismatch && (
        <WarningChip>
          <WarningIcon size={14} />
          <span>{t("Structure out of sync")}</span>
          <RepairButton onClick={() => engine?.repair()}>
            {t("Repair")}
          </RepairButton>
        </WarningChip>
      )}
      {checking ? (
        <Chip title={t("Checking grammar…")}>{t("Checking…")}</Chip>
      ) : issueCount > 0 ? (
        <DropdownMenu
          action={createActionWithChildren({
            name: t("Grammar issues"),
            section: ActiveDocumentSection,
            children: issues.map((issue) =>
              createAction({
                name: (
                  <IssueItem>
                    <IssueTitle>
                      {issue.match.shortMessage ?? issue.match.rule.category.name}
                    </IssueTitle>
                    <IssueMessage>{issue.match.message}</IssueMessage>
                  </IssueItem>
                ),
                section: ActiveDocumentSection,
                perform: () => grammarExtension?.revealIssue(issue),
              })
            ),
          })}
          ariaLabel={t("Grammar issues")}
          align="start"
        >
          <IssueChip>{issueCount}</IssueChip>
        </DropdownMenu>
      ) : null}
      <DropdownMenu
        action={createActionWithChildren({
          name: t("Save"),
          section: ActiveDocumentSection,
          children: saveActions,
        })}
        ariaLabel={t("Save bilingual document")}
        align="start"
      >
        <Button neutral hideIcon disabled={saving}>
          {t("Save")}
        </Button>
      </DropdownMenu>
      <DropdownMenu
        action={createActionWithChildren({
          name: t("Bilingual settings"),
          section: ActiveDocumentSection,
          children: settingsActions,
        })}
        ariaLabel={t("Bilingual settings")}
        align="start"
      >
        <Button neutral icon={<SettingsIcon />} />
      </DropdownMenu>
    </Bar>
  );
});

const Bar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: ${s("textSecondary")};
  background: ${s("backgroundSecondary")};
  border-radius: 99px;
  padding: 3px 10px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

const WarningChip = styled(Chip)`
  color: ${s("noticeWarningText")};
  background: ${s("noticeWarningBackground")};
  gap: 6px;
`;

const RepairButton = styled.button`
  background: none;
  border: 1px solid ${s("noticeWarningText")};
  color: ${s("noticeWarningText")};
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  padding: 1px 8px;
`;

const IssueChip = styled(Chip)`
  color: #fff;
  background: ${s("accent")};
  cursor: pointer;
`;

const IssueItem = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 340px;
`;

const IssueTitle = styled.span`
  font-weight: 600;
`;

const IssueMessage = styled.span`
  color: ${s("textSecondary")};
  font-weight: 400;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
