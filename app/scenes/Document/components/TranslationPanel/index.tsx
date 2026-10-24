import { observer } from "mobx-react";
import { ArrowIcon } from "outline-icons";
import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import {
  TRANSLATION_AUTO_DETECT,
  translationLanguages,
} from "@shared/constants";
import { errToString } from "@shared/utils/error";
import { richExtensions } from "@shared/editor/nodes";
import type { ProsemirrorDoc } from "@shared/types";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { UserPreference } from "@shared/types";
import Editor from "~/components/Editor";
import type { Editor as SharedEditor } from "~/editor";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import { InputSelect } from "~/components/InputSelect";
import type { Option } from "~/components/InputSelect";
import { useDocumentContext } from "~/components/DocumentContext";
import useCurrentUser from "~/hooks/useCurrentUser";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import Scrollable from "~/components/Scrollable";
import { client } from "~/utils/ApiClient";
import {
  buildMirrorDocJSON,
  collectTranslationUnits,
  removeTranslations,
} from "~/utils/documentTranslation";

/** Delay after the last keystroke before translation is requested. */
const DEBOUNCE_MS = 1200;

/** Delay before a hovered block's translation card appears. */
const HOVER_INTENT_MS = 350;

type Status = "idle" | "loading" | "error";

type HoverState = {
  /** Top level block index the card is anchored to */
  index: number;
  text: string;
  translation: string | null;
  loading: boolean;
  left: number;
  top: number;
} | null;

function TranslationPanel() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const user = useCurrentUser();
  const context = useDocumentContext();
  const doc = context.editorDoc;

  const preferences = user?.preferences;
  const sourceLanguage =
    preferences?.[UserPreference.TranslationSourceLanguage] ??
    TRANSLATION_AUTO_DETECT;
  const targetLanguage =
    preferences?.[UserPreference.TranslationTargetLanguage] ??
    team.translation?.targetLanguage ??
    "zh-CN";

  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [mirror, setMirror] = React.useState<ProsemirrorDoc | null>(null);
  const [mirrorVersion, setMirrorVersion] = React.useState(0);
  const [hover, setHover] = React.useState<HoverState>(null);

  // Incremented with every fetch run so stale loops can be discarded.
  const requestSeq = React.useRef(0);
  const panelEditorRef = React.useRef<SharedEditor | null>(null);
  const writeBackTimerRef = React.useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  // Cache of source text to translation, shared by the mirror and the hover
  // card so a block is only ever translated once.
  const cacheRef = React.useRef(new Map<string, string>());
  // Manual edits made in the mirror editor, keyed by source text. They live
  // for the current session only and are never written to the document.
  const panelEditsRef = React.useRef(new Map<string, string>());

  // Machine translations with manual mirror edits taking precedence.
  const effectiveTranslations = React.useCallback(() => {
    const merged = new Map(cacheRef.current);
    panelEditsRef.current.forEach((value, key) => merged.set(key, value));
    return merged;
  }, []);

  // Reset when navigating between documents.
  React.useEffect(() => {
    cacheRef.current = new Map();
    panelEditsRef.current = new Map();
    setMirror(null);
    setStatus("idle");
    setError(null);
    setHover(null);
  }, [context.document?.id]);

  // Translations are display only: clean up translated blocks that older
  // versions of this feature inserted into the document body.
  React.useEffect(() => {
    const editor = context.editor;
    if (editor) {
      removeTranslations(editor);
    }
  }, [context.editor, context.document?.id]);

  // Keep the mirror in sync with the document, rebuilding shortly after each
  // change so typing on the left updates the right side.
  React.useEffect(() => {
    if (!doc) {
      return;
    }

    const timer = setTimeout(() => {
      setMirror(buildMirrorDocJSON(doc, effectiveTranslations()));
      setMirrorVersion((version) => version + 1);
    }, 200);

    return () => clearTimeout(timer);
  }, [doc, effectiveTranslations]);

  // Fetch translations for source blocks that are not cached yet.
  React.useEffect(() => {
    if (!doc) {
      return;
    }

    const timer = setTimeout(async () => {
      const seq = ++requestSeq.current;

      const units = collectTranslationUnits(doc);
      const pending = units.filter((unit) => !cacheRef.current.has(unit));

      if (pending.length === 0) {
        setStatus("idle");
        return;
      }

      setStatus("loading");
      setError(null);

      for (const unit of pending) {
        if (seq !== requestSeq.current) {
          return;
        }

        try {
          const res = await client.post("/translations.translate", {
            text: unit,
            sourceLanguage,
            targetLanguage,
          });

          if (seq !== requestSeq.current) {
            return;
          }
          cacheRef.current.set(unit, res.data.text);
        } catch (err) {
          if (seq !== requestSeq.current) {
            return;
          }
          setStatus("error");
          setError(errToString(err));
          return;
        }
      }

      if (seq !== requestSeq.current) {
        return;
      }

      // New translations are available: rebuild the mirror.
      setStatus("idle");
      setMirror(buildMirrorDocJSON(doc, effectiveTranslations()));
      setMirrorVersion((version) => version + 1);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [doc, sourceLanguage, targetLanguage, effectiveTranslations]);

  // Hover translation: moving the mouse over a block in the editor shows a
  // small card with that block's translation.
  const editorDom = context.editor?.view.dom;
  const hoverSeq = React.useRef(0);
  const hoverBlockRef = React.useRef<HTMLElement | null>(null);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const clearHoverCard = React.useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
    }
    hoverBlockRef.current = null;
    setHover(null);
  }, []);

  React.useEffect(() => {
    if (!editorDom) {
      return;
    }

    const showCard = async (block: HTMLElement) => {
      const seq = ++hoverSeq.current;
      const root = block.parentElement;
      const index = root
        ? Array.prototype.indexOf.call(root.children, block)
        : -1;
      const node = index >= 0 ? doc?.maybeChild(index) : undefined;
      const text = node?.textContent.trim();
      const rect = block.getBoundingClientRect();

      if (!node || !text) {
        setHover(null);
        return;
      }

      const cached = cacheRef.current.get(text);

      if (cached) {
        setHover({
          index,
          text,
          translation: cached,
          loading: false,
          left: rect.left,
          top: rect.bottom + 6,
        });
        return;
      }

      setHover({
        index,
        text,
        translation: null,
        loading: true,
        left: rect.left,
        top: rect.bottom + 6,
      });

      try {
        const res = await client.post("/translations.translate", {
          text,
          sourceLanguage,
          targetLanguage,
        });

        if (seq !== hoverSeq.current) {
          return;
        }
        cacheRef.current.set(text, res.data.text);
        setHover((state) =>
          state && state.index === index
            ? {
                ...state,
                translation: res.data.text,
                loading: false,
              }
            : state
        );
      } catch (err) {
        if (seq !== hoverSeq.current) {
          return;
        }
        setHover((state) =>
          state && state.index === index
            ? { ...state, translation: errToString(err), loading: false }
            : state
        );
      }
    };

    const handleMouseOver = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const block = target.closest<HTMLElement>(".ProseMirror > *");
      if (!block || block === hoverBlockRef.current) {
        return;
      }

      hoverBlockRef.current = block;
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      hoverTimerRef.current = setTimeout(() => {
        void showCard(block);
      }, HOVER_INTENT_MS);
    };

    editorDom.addEventListener("mouseover", handleMouseOver);
    editorDom.addEventListener("mouseleave", clearHoverCard);

    return () => {
      editorDom.removeEventListener("mouseover", handleMouseOver);
      editorDom.removeEventListener("mouseleave", clearHoverCard);
    };
  }, [editorDom, doc, sourceLanguage, targetLanguage, clearHoverCard]);

  // Track manual edits from the mirror editor so they survive rebuilds.
  const handleMirrorChange = React.useCallback(() => {
    if (writeBackTimerRef.current) {
      clearTimeout(writeBackTimerRef.current);
    }

    writeBackTimerRef.current = setTimeout(() => {
      const panelEditor = panelEditorRef.current;
      const editor = context.editor;

      if (!panelEditor || !editor) {
        return;
      }

      const units = collectTranslationUnits(editor.view.state.doc);
      const blocks: ProsemirrorNode[] = [];
      panelEditor.view.state.doc.forEach((child) => blocks.push(child));

      units.forEach((source, index) => {
        const block = blocks[index];
        if (!block) {
          return;
        }
        const machine = cacheRef.current.get(source);
        if (block.textContent !== machine) {
          panelEditsRef.current.set(source, block.textContent);
        } else {
          panelEditsRef.current.delete(source);
        }
      });
    }, 400);
  }, [context.editor]);

  const sourceOptions: Option[] = React.useMemo(
    () => [
      {
        type: "item",
        value: TRANSLATION_AUTO_DETECT,
        label: t("Auto detect"),
      },
      ...translationLanguages.map((language) => ({
        type: "item" as const,
        value: language.value,
        label: language.label,
      })),
    ],
    [t]
  );

  const targetOptions: Option[] = React.useMemo(
    () =>
      translationLanguages.map((language) => ({
        type: "item" as const,
        value: language.value,
        label: language.label,
      })),
    []
  );

  const handleSourceChange = React.useCallback(
    (value: string) => {
      if (!user) {
        return;
      }
      user.setPreference(UserPreference.TranslationSourceLanguage, value);
      void user.save();
    },
    [user]
  );

  const handleTargetChange = React.useCallback(
    (value: string) => {
      if (!user) {
        return;
      }
      user.setPreference(UserPreference.TranslationTargetLanguage, value);
      void user.save();
    },
    [user]
  );

  const handleSwap = React.useCallback(() => {
    if (!user || sourceLanguage === TRANSLATION_AUTO_DETECT) {
      return;
    }
    user.setPreference(
      UserPreference.TranslationSourceLanguage,
      targetLanguage
    );
    user.setPreference(
      UserPreference.TranslationTargetLanguage,
      sourceLanguage
    );
    void user.save();
  }, [user, sourceLanguage, targetLanguage]);

  return (
    <>
      <PanelBody column>
        <SelectsRow gap={6} align="center">
          <InputSelect
            short
            options={sourceOptions}
            value={sourceLanguage}
            onChange={handleSourceChange}
            label={t("Source language")}
            labelHidden
          />
          <SwapButton
            onClick={handleSwap}
            disabled={sourceLanguage === TRANSLATION_AUTO_DETECT}
            aria-label={t("Swap languages")}
          >
            <ArrowIcon />
          </SwapButton>
          <InputSelect
            short
            options={targetOptions}
            value={targetLanguage}
            onChange={handleTargetChange}
            label={t("Target language")}
            labelHidden
          />
          <Flex auto justify="flex-end" align="center">
            {status === "loading" && (
              <Text type="tertiary" size="xsmall">
                {t("Translating")}…
              </Text>
            )}
          </Flex>
        </SelectsRow>

        <PaneScrollable hiddenScrollbars topShadow>
          <DocumentLike>
            <MirrorTitle>
              {context.document?.title || t("Untitled")}
            </MirrorTitle>
            {mirror ? (
              <Editor
                key={mirrorVersion}
                ref={panelEditorRef}
                extensions={richExtensions}
                defaultValue={mirror}
                onChange={handleMirrorChange}
                embedsDisabled
              />
            ) : status === "error" ? (
              <Placeholder>
                <Text type="secondary">{error}</Text>
              </Placeholder>
            ) : status === "loading" ? (
              <Placeholder>
                <Text type="secondary">{t("Translating")}…</Text>
              </Placeholder>
            ) : (
              <Placeholder>
                <Text type="secondary">
                  {t(
                    "Start writing on the left, the translation appears here."
                  )}
                </Text>
              </Placeholder>
            )}
          </DocumentLike>
        </PaneScrollable>

        <Footer>
          <Text type="tertiary" size="xsmall">
            {t(
              "Translations are shown here and on hover only – they are never saved into the document. Hover over a paragraph on the left to see its translation, or edit it right here."
            )}
          </Text>
        </Footer>
      </PanelBody>
      {hover &&
        createPortal(
          <HoverCard style={{ left: hover.left, top: hover.top }}>
            {hover.loading ? (
              <Text type="secondary" size="small">
                {t("Translating")}…
              </Text>
            ) : (
              <Text size="small">{hover.translation}</Text>
            )}
          </HoverCard>,
          document.body
        )}
    </>
  );
}

const PanelBody = styled(Flex)`
  flex: 1;
  min-height: 0;
  gap: 8px;
`;

const SelectsRow = styled(Flex)`
  padding-right: 16px;
`;

const SwapButton = styled.button`
  border: 0;
  background: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  color: ${s("textSecondary")};
  display: flex;
  align-items: center;

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
  &:hover:not(:disabled) {
    background: ${s("backgroundSecondary")};
  }
`;

const DocumentLike = styled.div`
  padding: 8px 32px 40px 8px;
`;

const MirrorTitle = styled.h1`
  margin: 0.5em 0 0.3em;
  font-size: 34px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.02em;
  color: ${s("text")};
`;

const Placeholder = styled(Flex)`
  min-height: 40vh;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 16px;
`;

const PaneScrollable = styled(Scrollable)`
  flex: 1;
  min-height: 0;
`;

const Footer = styled(Flex)`
  padding: 4px 16px 0 0;
`;

const HoverCard = styled.div`
  position: fixed;
  z-index: 1000;
  max-width: 480px;
  padding: 8px 12px;
  border-radius: 6px;
  background: ${s("background")};
  border: 1px solid ${s("inputBorder")};
  box-shadow: ${s("menuShadow")};
`;

export default observer(TranslationPanel);
