import * as React from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router";
import styled from "styled-components";
import { s } from "@shared/styles";
import type { RouteComponentProps, StaticContext } from "react-router";
import type { BilingualPairDTO } from "@shared/types/bilingual";
import { richExtensions, withComments } from "@shared/editor/nodes";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import LoadingIndicator from "~/components/LoadingIndicator";
import useCurrentUser from "~/hooks/useCurrentUser";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import { withUIExtensions } from "~/editor/extensions";
import CodeWordBreak from "@shared/editor/extensions/CodeWordBreak";
import BilingualMirrorExtension from "~/editor/extensions/BilingualMirror";
import GrammarCheckExtension from "~/editor/extensions/GrammarCheck";
import HoverTranslateExtension from "~/editor/extensions/HoverTranslate";
import AsyncMultiplayerEditor from "~/scenes/Document/components/AsyncMultiplayerEditor";
import BilingualStore from "~/stores/BilingualStore";
import { documentPath } from "~/utils/routeHelpers";
import { ensureBilingualStyles } from "~/utils/bilingual/styles";
import { MirrorEngine } from "~/utils/bilingual/mirrorEngine";

const baseExtensions = [
  CodeWordBreak,
  ...withUIExtensions(withComments(richExtensions)),
];

type Params = { documentSlug: string };

type Props = RouteComponentProps<Params, StaticContext>;

/**
 * The bilingual split editor: source (English) document on the left, mirror
 * (Chinese) document on the right, with structure mirroring, per-block
 * translation, hover translation, and grammar checking.
 */
function BilingualDocumentScene(props: Props) {
  const { t } = useTranslation();
  const history = useHistory();
  const { documents } = useStores();
  const user = useCurrentUser({ rejectOnEmpty: false });
  const { documentSlug } = props.match.params;
  const [pair, setPair] = React.useState<{
    pair: BilingualPairDTO | null;
    sourceDocumentId?: string;
    targetDocumentId?: string;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [issueCount, setIssueCount] = React.useState(0);
  const engine = React.useMemo(() => new MirrorEngine(), []);

  const document = documents.get(documentSlug);

  React.useEffect(() => {
    ensureBilingualStyles();
  }, []);

  React.useEffect(() => {
    if (!document) {
      void documents.fetch(documentSlug);
    }
  }, [document, documents, documentSlug]);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!document) {
        return;
      }

      setLoading(true);

      try {
        const info = await BilingualStore.fetchInfo(document.id);

        if (!cancelled) {
          setPair(info);
          setLoading(false);
        }
      } catch (_err) {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [document]);

  React.useEffect(() => () => engine.destroy(), [engine]);

  const can = usePolicy(document);
  const pairData = pair?.pair;

  const sourceId = pairData?.sourceDocumentId;
  const targetId = pairData?.targetDocumentId;
  const sourceDocument = sourceId ? documents.get(sourceId) : undefined;
  const targetDocument = targetId ? documents.get(targetId) : undefined;

  React.useEffect(() => {
    if (sourceId && !sourceDocument) {
      void documents.fetch(sourceId);
    }
  }, [sourceId, sourceDocument, documents]);

  React.useEffect(() => {
    if (targetId && !targetDocument) {
      void documents.fetch(targetId);
    }
  }, [targetId, targetDocument, documents]);

  React.useEffect(() => {
    if (pairData) {
      engine.setup(pairData.id, pairData.blockStates);
    }
  }, [pairData, engine]);

  const grammarEnabled = true;
  const level = "default" as const;

  const sourceExtensions = React.useMemo(
    () => [
      ...baseExtensions,
      new BilingualMirrorExtension({ engine, side: "source" }),
      new HoverTranslateExtension({
        mode: "dot",
        onInsertText: (blockIndex, text) => engine.forceWrite(blockIndex, text),
      }),
      new GrammarCheckExtension({
        enabled: grammarEnabled,
        level,
        language: "en-US",
        onIssueCountChange: setIssueCount,
      }),
    ],
    [engine]
  );

  const targetExtensions = React.useMemo(
    () => [
      ...baseExtensions,
      new BilingualMirrorExtension({ engine, side: "target" }),
    ],
    [engine]
  );

  const handleEnable = async () => {
    if (!document) {
      return;
    }

    setCreating(true);

    try {
      await BilingualStore.createPair({ documentId: document.id });
      const info = await BilingualStore.fetchInfo(document.id);
      setPair(info);
    } catch (_err) {
      // A pair likely already exists; refresh the info.
      const info = await BilingualStore.fetchInfo(document.id);
      setPair(info);
    } finally {
      setCreating(false);
    }
  };

  const handleTitleChange = async (value: string) => {
    if (!sourceDocument) {
      return;
    }

    sourceDocument.title = value;
    await sourceDocument.save({ title: value });

    if (targetDocument) {
      targetDocument.title = value;
      await targetDocument.save({ title: value });
    }
  };

  if (!document || loading) {
    return (
      <Centered>
        <LoadingIndicator />
      </Centered>
    );
  }

  if (!pairData || !sourceId || !targetId) {
    return (
      <Centered>
        <Heading>{t("Bilingual")}</Heading>
        <Description>
          {t(
            "This document is not bilingual yet. Enable it to write English on the left with a synchronized Chinese translation on the right."
          )}
        </Description>
        <Button onClick={handleEnable} disabled={creating || !can?.update}>
          {creating ? t("Enabling…") : t("Enable bilingual")}
        </Button>
      </Centered>
    );
  }

  return (
    <Wrapper column>
      <BilingualHeader>
        <BackButton
          onClick={() => sourceDocument && history.push(documentPath(sourceDocument))}
        >
          ← {sourceDocument?.title ?? t("Back to document")}
        </BackButton>
        <PaneLabel $active>{t("English · source")}</PaneLabel>
        <PaneLabel>{t("Chinese · mirror")}</PaneLabel>
        <div style={{ flex: 1 }} />
        {engine.hasMismatch && (
          <MismatchNotice>
            {t("Structure out of sync")}
            <RepairButton onClick={() => engine.repair()}>
              {t("Repair")}
            </RepairButton>
          </MismatchNotice>
        )}
        {issueCount > 0 && (
          <IssueBadge aria-label={t("Grammar issues")}>
            {issueCount}
          </IssueBadge>
        )}
      </BilingualHeader>
      <Panes>
        <Pane>
          <PaneHeader>
            <TitleInput
              value={sourceDocument?.title ?? ""}
              onChange={(event) => void handleTitleChange(event.currentTarget.value)}
              aria-label={t("Source title")}
              placeholder={t("Untitled")}
            />
          </PaneHeader>
          <EditorScroll>
            {sourceDocument && (
              <AsyncMultiplayerEditor
                id={sourceDocument.id}
                extensions={sourceExtensions}
                placeholder={t("Start writing in English…")}
                userId={user?.id}
              />
            )}
          </EditorScroll>
        </Pane>
        <Divider />
        <Pane>
          <PaneHeader>
            <TitleInput
              value={targetDocument?.title ?? ""}
              readOnly
              aria-label={t("Mirror title")}
              placeholder={t("Untitled")}
            />
          </PaneHeader>
          <EditorScroll>
            {targetDocument && (
              <AsyncMultiplayerEditor
                id={targetDocument.id}
                extensions={targetExtensions}
                placeholder={t("The Chinese translation appears here…")}
                userId={user?.id}
              />
            )}
          </EditorScroll>
        </Pane>
      </Panes>
    </Wrapper>
  );
}

export default BilingualDocumentScene;

const Wrapper = styled(Flex)`
  height: calc(100vh - var(--header-offset, 64px));
  background: ${s("background")};
`;

const Centered = styled(Flex)`
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
  height: 60vh;
`;

const Description = styled.p`
  color: ${s("textSecondary")};
  max-width: 420px;
  text-align: center;
`;

const Heading = styled.h1`
  font-size: 24px;
  margin: 0;
`;

const BilingualHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid ${s("divider")};
  background: ${s("backgroundSecondary")};
  min-height: 44px;
`;

const BackButton = styled.button`
  background: none;
  border: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  font-size: 13px;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PaneLabel = styled.span<{ $active?: boolean }>`
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => (props.$active ? s("accent") : s("textSecondary"))};
`;

const MismatchNotice = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: ${s("noticeWarningText")};
  font-size: 12px;
`;

const RepairButton = styled.button`
  background: none;
  border: 1px solid ${s("noticeWarningText")};
  color: ${s("noticeWarningText")};
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 8px;
`;

const IssueBadge = styled.span`
  background: ${s("danger")};
  color: #fff;
  border-radius: 10px;
  font-size: 11px;
  padding: 1px 7px;
`;

const Panes = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`;

const Pane = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const Divider = styled.div`
  width: 1px;
  background: ${s("divider")};
`;

const PaneHeader = styled.div`
  padding: 12px 24px 0;
`;

const TitleInput = styled.input`
  width: 100%;
  background: none;
  border: none;
  outline: none;
  color: ${s("text")};
  font-size: 22px;
  font-weight: 600;
  font-family: inherit;

  &:read-only {
    color: ${s("textSecondary")};
  }
`;

const EditorScroll = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 24px 30vh;
`;
