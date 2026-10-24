import { observer } from "mobx-react";
import { observable } from "mobx";
import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import { errToString } from "@shared/utils/error";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import { useDocumentContext } from "~/components/DocumentContext";
import Scrollable from "~/components/Scrollable";
import { client } from "~/utils/ApiClient";
import {
  applyGrammarFix,
  collectBlockText,
  collectGrammarUnits,
  filterGrammarMatches,
  isCheckableText,
  type GrammarMatch,
} from "~/utils/documentGrammar";

/** Delay after the last keystroke before the document is checked. */
const DEBOUNCE_MS = 1200;

/** Delay before a hovered block's issue card appears. */
const HOVER_INTENT_MS = 350;

/** Maximum number of replacement suggestions shown per issue. */
const MAX_SUGGESTIONS = 5;

/** Maximum number of issues listed in the hover card. */
const MAX_HOVER_ISSUES = 3;

type Status = "idle" | "loading" | "error";

type IssueGroup = {
  /** The checked block text the match offsets refer to */
  unit: string;
  matches: GrammarMatch[];
};

type HoverState = {
  /** Top level block index the card is anchored to */
  index: number;
  text: string;
  matches: GrammarMatch[] | null;
  loading: boolean;
  error: string | null;
  left: number;
  top: number;
} | null;

type IssueKind = "danger" | "warning" | "accent";

/**
 * Returns the theme token used to highlight an issue. Spelling mistakes are
 * red, grammar issues orange and style hints blue.
 *
 * @param match The issue to color.
 * @returns The theme token name.
 */
function issueKind(match: GrammarMatch): IssueKind {
  if (match.issueType === "misspelling") {
    return "danger";
  }
  if (match.issueType === "grammar") {
    return "warning";
  }
  return "accent";
}

function GrammarPanel() {
  const { t } = useTranslation();
  const context = useDocumentContext();
  const doc = context.editorDoc;

  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [hover, setHover] = React.useState<HoverState>(null);

  // Incremented with every fetch run so stale loops can be discarded.
  const requestSeq = React.useRef(0);
  // Checked blocks keyed by their text. A block is only ever sent to the
  // grammar service once unless its text changes. An observable map is used
  // so the issue list re-renders when a check completes.
  const [results] = React.useState(() =>
    observable.map<string, GrammarMatch[]>()
  );

  // Reset when navigating between documents.
  React.useEffect(() => {
    results.clear();
    setStatus("idle");
    setError(null);
    setHover(null);
  }, [context.document?.id, results]);

  // Check every block that is not cached yet, shortly after the last change.
  React.useEffect(() => {
    if (!doc) {
      return;
    }

    const timer = setTimeout(async () => {
      const seq = ++requestSeq.current;

      const units = collectGrammarUnits(doc).filter(isCheckableText);
      const pending = units.filter((unit) => !results.has(unit));

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
          const res = await client.post("/grammar.check", {
            text: unit,
          });

          if (seq !== requestSeq.current) {
            return;
          }
          const matches: GrammarMatch[] = res.data.matches;
          results.set(unit, filterGrammarMatches(unit, matches));
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

      setStatus("idle");
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [doc, results]);

  // Hover issues: moving the mouse over a block in the editor shows a small
  // card with that block's issues.
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
      const text = node ? collectBlockText(node).trim() : undefined;
      const rect = block.getBoundingClientRect();

      if (!node || !text) {
        setHover(null);
        return;
      }

      const cached = results.get(text);

      if (cached) {
        setHover({
          index,
          text,
          matches: cached,
          loading: false,
          error: null,
          left: rect.left,
          top: rect.bottom + 6,
        });
        return;
      }

      setHover({
        index,
        text,
        matches: null,
        loading: true,
        error: null,
        left: rect.left,
        top: rect.bottom + 6,
      });

      try {
        const res = await client.post("/grammar.check", { text });

        if (seq !== hoverSeq.current) {
          return;
        }
        const matches: GrammarMatch[] = res.data.matches;
        const filtered = filterGrammarMatches(text, matches);
        results.set(text, filtered);
        setHover((state) =>
          state && state.index === index
            ? { ...state, matches: filtered, loading: false }
            : state
        );
      } catch (err) {
        if (seq !== hoverSeq.current) {
          return;
        }
        setHover((state) =>
          state && state.index === index
            ? { ...state, loading: false, error: errToString(err) }
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
  }, [editorDom, doc, results, clearHoverCard]);

  const handleApply = React.useCallback(
    (unit: string, match: GrammarMatch, replacement: string) => {
      const editor = context.editor;

      if (editor) {
        const applied = applyGrammarFix(editor, {
          unitText: unit,
          offset: match.offset,
          length: match.length,
          replacement,
        });

        if (!applied) {
          toast.error(t("The text has changed, please try again"));
        }
      }

      // The block text changed; drop the stale issues and let the regular
      // check pass re-check the block shortly after.
      results.delete(unit);
    },
    [context.editor, results, t]
  );

  const categoryLabel = React.useCallback(
    (match: GrammarMatch) => {
      switch (match.issueType) {
        case "misspelling":
          return t("Spelling");
        case "style":
        case "register":
          return t("Style");
        case "whitespace":
        case "typographical":
        case "characters":
        case "formatting":
          return t("Punctuation");
        case "grammar":
          return t("Grammar");
        default:
          return t("Other");
      }
    },
    [t]
  );

  // The issue list is derived on each render: cheap map lookups over the
  // blocks of the current document.
  const issueGroups: IssueGroup[] = [];
  if (doc) {
    for (const unit of collectGrammarUnits(doc)) {
      const matches = results.get(unit);
      if (matches && matches.length > 0) {
        issueGroups.push({ unit, matches });
      }
    }
  }
  const issueCount = issueGroups.reduce(
    (sum, group) => sum + group.matches.length,
    0
  );

  return (
    <>
      <PanelBody column>
        <StatusRow justify="flex-end" align="center">
          {status === "loading" && (
            <Text type="tertiary" size="xsmall">
              {t("Checking")}…
            </Text>
          )}
          {status === "error" && error && (
            <Text type="secondary" size="xsmall">
              {error}
            </Text>
          )}
        </StatusRow>

        <PanelScrollable hiddenScrollbars topShadow>
          <DocumentLike>
            {issueGroups.length > 0 ? (
              <IssueList column gap={16}>
                {issueGroups.map((group) =>
                  group.matches.map((match, index) => (
                    <IssueRow
                      key={`${group.unit}-${match.offset}-${index}`}
                      unit={group.unit}
                      match={match}
                      category={categoryLabel(match)}
                      kind={issueKind(match)}
                      onApply={handleApply}
                    />
                  ))
                )}
              </IssueList>
            ) : status === "error" ? (
              <Placeholder>
                <Text type="secondary">{error}</Text>
              </Placeholder>
            ) : status === "loading" && issueCount === 0 ? (
              <Placeholder>
                <Text type="secondary">{t("Checking")}…</Text>
              </Placeholder>
            ) : (
              <Placeholder>
                <Text type="secondary">
                  {t("No issues found")}.
                  {issueCount === 0 && doc
                    ? ` ${t("Grammar issues appear here while you write.")}`
                    : ""}
                </Text>
              </Placeholder>
            )}
          </DocumentLike>
        </PanelScrollable>

        <Footer>
          <Text type="tertiary" size="xsmall">
            {t(
              "Grammar issues are shown here and on hover only – nothing is changed automatically. Click a suggestion to apply it to the document."
            )}
          </Text>
        </Footer>
      </PanelBody>
      {hover &&
        createPortal(
          <HoverCard style={{ left: hover.left, top: hover.top }}>
            {hover.loading ? (
              <Text type="secondary" size="small">
                {t("Checking")}…
              </Text>
            ) : hover.error ? (
              <Text type="secondary" size="small">
                {hover.error}
              </Text>
            ) : hover.matches && hover.matches.length > 0 ? (
              <HoverIssueList column gap={6}>
                {hover.matches
                  .slice(0, MAX_HOVER_ISSUES)
                  .map((match, index) => (
                    <Text key={index} size="small">
                      {match.context && (
                        <Wrong $kind={issueKind(match)}>
                          {match.context.text.slice(
                            match.context.offset,
                            match.context.offset + match.context.length
                          )}
                        </Wrong>
                      )}{" "}
                      {match.shortMessage ?? match.message}
                    </Text>
                  ))}
                {hover.matches.length > MAX_HOVER_ISSUES && (
                  <Text type="tertiary" size="xsmall">
                    +{hover.matches.length - MAX_HOVER_ISSUES}
                  </Text>
                )}
              </HoverIssueList>
            ) : (
              <Text type="secondary" size="small">
                {t("No issues found")}
              </Text>
            )}
          </HoverCard>,
          document.body
        )}
    </>
  );
}

type IssueRowProps = {
  unit: string;
  match: GrammarMatch;
  category: string;
  kind: IssueKind;
  onApply: (unit: string, match: GrammarMatch, replacement: string) => void;
};

function IssueRow({ unit, match, category, kind, onApply }: IssueRowProps) {
  const span = match.context
    ? match.context.text.slice(
        match.context.offset,
        match.context.offset + match.context.length
      )
    : unit.slice(match.offset, match.offset + match.length);

  return (
    <IssueCard>
      <ContextText>
        {match.context
          ? match.context.text.slice(0, match.context.offset)
          : unit.slice(0, match.offset)}
        <Wrong $kind={kind}>{span}</Wrong>
        {match.context
          ? match.context.text.slice(
              match.context.offset + match.context.length
            )
          : unit.slice(match.offset + match.length)}
      </ContextText>
      <Flex align="flex-start" gap={6}>
        <CategoryTag $kind={kind}>{category}</CategoryTag>
        <MessageText size="small" type="secondary">
          {match.message}
        </MessageText>
      </Flex>
      {match.replacements.length > 0 && (
        <SuggestionsRow gap={6} wrap>
          {match.replacements
            .slice(0, MAX_SUGGESTIONS)
            .map((replacement, index) => (
              <SuggestionChip
                key={`${match.offset}-${index}`}
                onClick={() => onApply(unit, match, replacement.value)}
              >
                {replacement.value}
              </SuggestionChip>
            ))}
        </SuggestionsRow>
      )}
    </IssueCard>
  );
}

const PanelBody = styled(Flex)`
  flex: 1;
  min-height: 0;
  gap: 8px;
`;

const StatusRow = styled(Flex)`
  padding-right: 16px;
  min-height: 20px;
`;

const DocumentLike = styled.div`
  padding: 8px 32px 40px 0;
`;

const Placeholder = styled(Flex)`
  min-height: 40vh;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 16px;
`;

const PanelScrollable = styled(Scrollable)`
  flex: 1;
  min-height: 0;
`;

const Footer = styled(Flex)`
  padding: 4px 16px 0 0;
`;

const IssueList = styled(Flex)``;

const IssueCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid ${s("inputBorder")};
  background: ${s("backgroundSecondary")};
`;

const ContextText = styled.div`
  font-size: 14px;
  line-height: 1.5;
  color: ${s("text")};
  word-break: break-word;
`;

const Wrong = styled.span<{ $kind: IssueKind }>`
  text-decoration: underline wavy ${(props) => props.theme[props.$kind]};
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
  font-weight: 600;
`;

const CategoryTag = styled.span<{ $kind: IssueKind }>`
  flex: none;
  margin-top: 1px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: ${(props) => props.theme[props.$kind]};
  border: 1px solid ${(props) => props.theme[props.$kind]};
  white-space: nowrap;
`;

const MessageText = styled(Text)`
  word-break: break-word;
`;

const SuggestionsRow = styled(Flex)`
  padding-left: 2px;
`;

const SuggestionChip = styled.button`
  border: 1px solid ${s("inputBorder")};
  background: ${s("background")};
  color: ${s("text")};
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    border-color: ${s("accent")};
    color: ${s("accent")};
  }
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

const HoverIssueList = styled(Flex)``;

export default observer(GrammarPanel);
