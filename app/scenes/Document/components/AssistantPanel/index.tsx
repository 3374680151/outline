import { observer } from "mobx-react";
import { CloseIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Flex from "~/components/Flex";
import useStores from "~/hooks/useStores";
import ResizeBorder from "~/components/Sidebar/components/ResizeBorder";
import { useResizeHandle } from "~/hooks/useResizeHandle";
import GrammarPanel from "../GrammarPanel";
import TranslationPanel from "../TranslationPanel";

/**
 * The writing aid pane shown next to the document. Hosts the translation and
 * grammar panels as tabs; exactly one of the two is visible at a time, which
 * is encoded in the two panel visibility flags of the UI store.
 */
function AssistantPanel() {
  const { t } = useTranslation();
  const { ui } = useStores();
  const translationActive = ui.translationPanelVisible;

  // Draggable width for the pane, persisted with the other UI state.
  const positionRef = React.useRef<HTMLDivElement | null>(null);
  const measure = React.useCallback((event: MouseEvent) => {
    const rect = positionRef.current?.getBoundingClientRect();
    if (!rect) {
      return undefined;
    }
    return rect.right - event.clientX;
  }, []);
  const handleResize = React.useCallback(
    (pixels: number) => {
      const ratio = Math.max(Math.min(pixels / window.innerWidth, 0.75), 0.2);
      ui.set({ translationPaneRatio: ratio });
    },
    [ui]
  );
  const { startResize } = useResizeHandle({
    measure,
    onResize: handleResize,
  });
  const handleResetWidth = React.useCallback(() => {
    // Reset back to a near-even split.
    ui.set({ translationPaneRatio: undefined });
  }, [ui]);

  const handleTranslationTab = React.useCallback(() => {
    ui.set({ translationPanelVisible: true, grammarPanelVisible: false });
  }, [ui]);

  const handleGrammarTab = React.useCallback(() => {
    ui.set({ grammarPanelVisible: true, translationPanelVisible: false });
  }, [ui]);

  const handleClose = React.useCallback(() => {
    ui.set({ translationPanelVisible: false, grammarPanelVisible: false });
  }, [ui]);

  return (
    <Pane column ref={positionRef}>
      <ResizeBorder
        onMouseDown={startResize}
        onDoubleClick={handleResetWidth}
        dir="right"
      />
      <PaneHeader align="center" justify="space-between">
        <TabRow role="tablist" gap={2}>
          <TabButton
            role="tab"
            aria-selected={translationActive}
            active={translationActive}
            onClick={handleTranslationTab}
          >
            {t("Translation")}
          </TabButton>
          <TabButton
            role="tab"
            aria-selected={!translationActive}
            active={!translationActive}
            onClick={handleGrammarTab}
          >
            {t("Grammar")}
          </TabButton>
        </TabRow>
        <CloseButton onClick={handleClose} aria-label={t("Close")}>
          <CloseIcon />
        </CloseButton>
      </PaneHeader>
      {translationActive ? <TranslationPanel /> : <GrammarPanel />}
    </Pane>
  );
}

const Pane = styled(Flex)`
  height: 100%;
  min-height: 0;
  gap: 8px;
  padding: 4px 0 0 16px;
`;

const PaneHeader = styled(Flex)`
  padding-right: 16px;
`;

const TabRow = styled(Flex)``;

const TabButton = styled.button<{ active: boolean }>`
  border: 0;
  background: ${(props) =>
    props.active ? props.theme.backgroundSecondary : "transparent"};
  color: ${(props) =>
    props.active ? props.theme.text : props.theme.textSecondary};
  font-weight: ${(props) => (props.active ? 600 : 400)};
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const CloseButton = styled.button`
  border: 0;
  background: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: ${s("textSecondary")};
  display: flex;
  align-items: center;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

export default observer(AssistantPanel);
