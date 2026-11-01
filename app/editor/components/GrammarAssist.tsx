import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import { useTranslation } from "react-i18next";
import type { GrammarMatchDTO } from "@shared/types/bilingual";
import type GrammarCheckExtension from "~/editor/extensions/GrammarCheck";
import {
  GRAMMAR_TYPES,
  GRAMMAR_TYPE_COLOR,
  GRAMMAR_TYPE_LABEL_KEY,
  matchType,
} from "~/utils/bilingual/matchType";

/** Width of the issue panel. */
const PANEL_WIDTH = 360;

/** Size of the floating badge. */
const BADGE_SIZE = 36;

/** Viewport inset used when pinning the badge to the pane corner. */
const INSET = 12;

/**
 * The floating grammar badge and issue panel, mounted by the grammar check
 * extension outside the editor DOM. The badge pins to the visible corner of
 * the editor pane and shows the open issue count; clicking it opens the
 * grouped issue panel where every fix happens (the Grammarly control-center
 * pattern). Underlines in the text are locators that open this panel.
 */
export const GrammarAssist = observer(function GrammarAssist({
  extension,
}: {
  extension: GrammarCheckExtension;
}) {
  const { t } = useTranslation();
  const badgeRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const issueCount = extension.issueCount;
  const checking = extension.checking;
  const unavailable = extension.unavailable;
  const panelOpen = extension.panelOpen;
  const activeIndex = extension.activeIssueIndex;
  const fixedCount = extension.fixedCount;
  // Reading the revision subscribes the panel to any change of the stored
  // matches, including swaps that leave the total count unchanged.
  void extension.revision;
  const issues = extension.listIssues();

  usePaneCornerPosition(extension, badgeRef, panelRef, panelOpen);

  // Pulse the badge when new issues are discovered, so the change is
  // noticeable while writing. Decreases (fixes) stay quiet on purpose.
  const prevIssueCount = React.useRef(issueCount);

  React.useEffect(() => {
    if (issueCount > prevIssueCount.current && badgeRef.current) {
      badgeRef.current.classList.remove("pulse");
      // Force a reflow so rapid re-checks restart the animation.
      void badgeRef.current.offsetWidth;
      badgeRef.current.classList.add("pulse");
    }
    prevIssueCount.current = issueCount;
  }, [issueCount]);

  React.useEffect(() => {
    if (!panelOpen) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        extension.closePanel();
      }
    };

    // Clicking anywhere outside the panel (and outside the triggers that
    // manage the panel themselves) dismisses it, matching the expectation
    // for popovers. Underline clicks reopen and refocus the panel, so they
    // must not race with this handler.
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      if (!target) {
        return;
      }

      if (
        panelRef.current?.contains(target) ||
        badgeRef.current?.contains(target)
      ) {
        return;
      }

      if (target.closest(".bilingual-underline")) {
        return;
      }

      extension.closePanel();
    };

    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [panelOpen, extension]);

  const badgeState = checking
    ? "checking"
    : unavailable
      ? "unavailable"
      : issueCount > 0
        ? "issues"
        : "clean";
  const badgeLabel =
    badgeState === "checking"
      ? t("Checking grammar…")
      : badgeState === "unavailable"
        ? t("Grammar service unavailable")
        : t("Grammar issues");

  return (
    <>
      <Badge
        ref={badgeRef}
        $state={badgeState}
        onClick={() =>
          extension.panelOpen ? extension.closePanel() : extension.openPanel()
        }
        aria-label={badgeLabel}
        title={badgeLabel}
        data-testid="grammar-badge"
      >
        {badgeState === "checking" ? (
          <Spinner />
        ) : badgeState === "unavailable" ? (
          "!"
        ) : badgeState === "issues" ? (
          issueCount
        ) : (
          "✓"
        )}
      </Badge>
      {panelOpen && (
        <Panel
          ref={panelRef}
          role="dialog"
          aria-label={t("Grammar panel")}
          data-testid="grammar-panel"
        >
          {issues.length === 0 ? (
            unavailable ? (
              <>
                <PanelHead>
                  <PanelTitle>{t("Grammar service unavailable")}</PanelTitle>
                  <CloseButton
                    onClick={() => extension.closePanel()}
                    aria-label={t("Close")}
                  >
                    ✕
                  </CloseButton>
                </PanelHead>
                <UnavailableBody>
                  <span>{t("Grammar service unavailable")}</span>
                  <RetryButton onClick={() => extension.recheckAll()}>
                    {t("Retry")}
                  </RetryButton>
                </UnavailableBody>
              </>
            ) : (
              <AllFixed>
                <div className="mark">✓</div>
                <b>{t("All issues fixed")}</b>
                <span>{t("New issues are underlined as you write")}</span>
              </AllFixed>
            )
          ) : (
            <>
              <PanelHead>
                <PanelTitle>
                  {t("{{count}} issues pending", { count: issues.length })}
                  <PanelSub>
                    {t("Click an issue to locate it in the document")}
                  </PanelSub>
                </PanelTitle>
                <NavGroup>
                  <NavButton
                    onClick={() => extension.moveFocus(-1)}
                    aria-label={t("Previous issue")}
                  >
                    ‹
                  </NavButton>
                  <Position>
                    {activeIndex === null
                      ? `–/${issues.length}`
                      : `${activeIndex + 1}/${issues.length}`}
                  </Position>
                  <NavButton
                    onClick={() => extension.moveFocus(1)}
                    aria-label={t("Next issue")}
                  >
                    ›
                  </NavButton>
                  <CloseButton
                    onClick={() => extension.closePanel()}
                    aria-label={t("Close")}
                  >
                    ✕
                  </CloseButton>
                </NavGroup>
              </PanelHead>
              <PanelBody>
                {GRAMMAR_TYPES.map((type) => {
                  const rows = issues
                    .map((issue, index) => ({ issue, index }))
                    .filter((row) => matchType(row.issue.match) === type);

                  if (rows.length === 0) {
                    return null;
                  }

                  const open = rows.filter(
                    (row) => row.index !== activeIndex
                  ).length;

                  return (
                    <React.Fragment key={type}>
                      <GroupTitle>
                        <GroupDot $color={GRAMMAR_TYPE_COLOR[type]} />
                        {t(GRAMMAR_TYPE_LABEL_KEY[type])}
                        {`（${open}）`}
                      </GroupTitle>
                      {rows.map(({ issue, index }) => (
                        <IssueRow
                          key={`${issue.blockIndex}-${issue.match.offset}-${issue.match.rule.id}`}
                          $active={index === activeIndex}
                          onClick={() => extension.focusIssueInText(index)}
                        >
                          <RowMain>
                            <Snippet>{renderSnippet(issue.match)}</Snippet>
                            <Loc>
                              {t("Block {{index}}", {
                                index: issue.blockIndex + 1,
                              })}
                            </Loc>
                            {issue.match.replacements.length > 0 &&
                              extension.canAutoFixAt(index) && (
                                <FixButton
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    extension.applyFixAt(
                                      index,
                                      issue.match.replacements[0].value
                                    );
                                  }}
                                  data-testid="grammar-panel-fix"
                                >
                                  {issue.match.replacements[0].value}
                                </FixButton>
                              )}
                          </RowMain>
                          {index === activeIndex && (
                            <RowDetail>
                              <ContextLine>
                                {renderContext(issue.match)}
                              </ContextLine>
                              <Message>{issue.match.message}</Message>
                              {issue.match.replacements.length > 0 &&
                                extension.canAutoFixAt(index) && (
                                  <ChipsRow>
                                    {issue.match.replacements
                                      .slice(0, 5)
                                      .map((replacement, chipIndex) => (
                                        <FixButton
                                          key={replacement.value}
                                          $recommended={chipIndex === 0}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            extension.applyFixAt(
                                              index,
                                              replacement.value
                                            );
                                          }}
                                        >
                                          {replacement.value}
                                        </FixButton>
                                      ))}
                                  </ChipsRow>
                                )}
                              {!extension.canAutoFixAt(index) && (
                                <Message>
                                  {t(
                                    "This issue spans formatting and cannot be auto-fixed"
                                  )}
                                </Message>
                              )}
                              <DetailActions>
                                <GhostLink
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    extension.skipIssueAt(index);
                                  }}
                                >
                                  {t("Skip once")}
                                </GhostLink>
                                <GhostLink
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    extension.ignoreRuleAt(index);
                                  }}
                                >
                                  {t("Ignore rule")}
                                </GhostLink>
                              </DetailActions>
                            </RowDetail>
                          )}
                        </IssueRow>
                      ))}
                    </React.Fragment>
                  );
                })}
              </PanelBody>
              <PanelFoot>
                <span>{t("Fixes can be undone in the editor")}</span>
                <span>
                  {t("Fixed {{fixed}} of {{total}}", {
                    fixed: fixedCount,
                    total: fixedCount + issues.length,
                  })}
                </span>
              </PanelFoot>
            </>
          )}
        </Panel>
      )}
    </>
  );
});

/**
 * Renders the snippet around a match with the issue text emphasized.
 *
 * @param match The grammar match with its context.
 * @returns The snippet markup.
 */
function renderSnippet(match: GrammarMatchDTO) {
  const { text, offset, length } = match.context;

  return (
    <>
      {text.slice(0, offset)}
      <Marked>{text.slice(offset, offset + length)}</Marked>
      {text.slice(offset + length)}
    </>
  );
}

/**
 * Renders the sentence context of a match with the issue emphasized — the
 * fuller "original text" section of the plugin's word card.
 *
 * @param match The grammar match with its context.
 * @returns The context markup.
 */
function renderContext(match: GrammarMatchDTO) {
  return renderSnippet(match);
}

/**
 * Pins the badge (and open panel) to the visible bottom-right corner of the
 * editor pane, following scroll and resize with merged animation frames.
 *
 * @param extension The grammar extension owning the editor.
 * @param badgeRef The badge element.
 * @param panelRef The panel element, when open.
 */
function usePaneCornerPosition(
  extension: GrammarCheckExtension,
  badgeRef: React.RefObject<HTMLDivElement | null>,
  panelRef: React.RefObject<HTMLDivElement | null>,
  panelOpen: boolean
) {
  React.useLayoutEffect(() => {
    let raf = 0;
    const update = () => {
      const rect = extension.paneRect();

      if (!rect) {
        return;
      }

      const bottom = Math.min(rect.bottom, window.innerHeight - INSET) - 16;
      const right = Math.min(rect.right, window.innerWidth - INSET) - 16;
      const badge = badgeRef.current;

      if (badge) {
        badge.style.left = `${right - BADGE_SIZE}px`;
        badge.style.top = `${bottom - BADGE_SIZE}px`;
      }

      const panel = panelRef.current;

      if (panel) {
        const top = Math.max(
          INSET + 4,
          bottom - BADGE_SIZE - 12 - panel.offsetHeight
        );
        panel.style.left = `${right - PANEL_WIDTH}px`;
        panel.style.top = `${top}px`;
      }
    };

    const schedule = () => {
      if (!raf) {
        raf = window.requestAnimationFrame(() => {
          raf = 0;
          update();
        });
      }
    };

    update();

    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);

    const panel = panelRef.current;
    let observer: ResizeObserver | undefined;

    if (panel && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(schedule);
      observer.observe(panel);
    }

    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      observer?.disconnect();

      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [extension, panelOpen, badgeRef, panelRef]);
}

const Badge = styled.div<{ $state: string }>`
  position: fixed;
  left: -9999px;
  top: -9999px;
  width: ${BADGE_SIZE}px;
  height: ${BADGE_SIZE}px;
  border-radius: 99px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: ${(props) =>
    props.$state === "unavailable"
      ? s("noticeWarningText")
      : props.$state === "clean"
        ? "#2f9e63"
        : s("accent")};
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.24);
  cursor: pointer;
  user-select: none;
  z-index: 2;

  &.pulse {
    animation: grammar-badge-pulse 0.8s ease-out 2;
  }

  @keyframes grammar-badge-pulse {
    0% {
      box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.24),
        0 0 0 0 rgba(47, 111, 208, 0.5);
    }
    100% {
      box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.24),
        0 0 0 14px rgba(47, 111, 208, 0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    &.pulse {
      animation: none;
    }
  }
`;

const Spinner = styled.span`
  width: 13px;
  height: 13px;
  border-radius: 99px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  animation: grammar-badge-spin 0.8s linear infinite;

  @keyframes grammar-badge-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Panel = styled.div`
  position: fixed;
  left: -9999px;
  top: -9999px;
  width: ${PANEL_WIDTH}px;
  max-width: calc(100vw - 24px);
  max-height: min(420px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  background: ${s("background")};
  color: ${s("text")};
  border: 1px solid ${s("divider")};
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
  font-size: 13px;
  line-height: 1.5;
  z-index: 1;
`;

const PanelHead = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid ${s("divider")};
`;

const PanelTitle = styled.div`
  font-weight: 600;
  font-size: 13px;
  flex: 1;
  min-width: 0;
`;

const PanelSub = styled.div`
  font-weight: 400;
  font-size: 11px;
  color: ${s("textSecondary")};
  margin-top: 1px;
`;

const NavGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
  margin-top: 1px;
`;

const NavButton = styled.button`
  width: 21px;
  height: 21px;
  border: 1px solid ${s("divider")};
  background: ${s("background")};
  color: ${s("text")};
  border-radius: 5px;
  font-size: 13px;
  line-height: 1;
  padding: 0;
  cursor: pointer;

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
`;

const Position = styled.span`
  font-size: 11px;
  color: ${s("textSecondary")};
  font-variant-numeric: tabular-nums;
  padding: 0 2px;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  font-size: 13px;
  padding: 2px 4px;
  flex: none;
`;

const PanelBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 6px 8px;
`;

const GroupTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  color: ${s("textSecondary")};
  padding: 7px 8px 3px;
`;

const GroupDot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 99px;
  background: ${(props) => props.$color};
  flex: none;
`;

const IssueRow = styled.div<{ $active: boolean }>`
  padding: 6px 8px;
  border-radius: 7px;
  cursor: pointer;
  background: ${(props) => (props.$active ? s("backgroundSecondary") : "transparent")};

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const RowMain = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const Snippet = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
`;

const Marked = styled.span`
  color: ${s("text")};
  font-weight: 600;
  text-decoration: underline wavy ${s("accent")} 1px;
  text-underline-offset: 2px;
`;

const Loc = styled.span`
  color: ${s("textTertiary")};
  font-size: 11px;
  flex: none;
  white-space: nowrap;
`;

const FixButton = styled.button<{ $recommended?: boolean }>`
  border: 1px solid
    ${(props) => (props.$recommended ? s("accent") : s("divider"))};
  background: ${(props) => (props.$recommended ? s("accent") : s("background"))};
  color: ${(props) => (props.$recommended ? "#fff" : s("text"))};
  border-radius: 5px;
  font-size: 11.5px;
  padding: 1.5px 9px;
  cursor: pointer;
  flex: none;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const RowDetail = styled.div`
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed ${s("divider")};
`;

const ContextLine = styled.div`
  font-size: 12.5px;
  line-height: 1.6;
  color: ${s("text")};
  background: ${s("backgroundSecondary")};
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
  word-break: break-word;
`;

const ChipsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
`;

const Message = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  word-break: break-word;
`;

const DetailActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
`;

const GhostLink = styled.button`
  background: none;
  border: none;
  color: ${s("textSecondary")};
  font-size: 12px;
  cursor: pointer;
  padding: 0;

  &:hover {
    color: ${s("text")};
  }
`;

const PanelFoot = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px solid ${s("divider")};
  padding: 7px 12px;
  font-size: 11px;
  color: ${s("textSecondary")};
`;

const AllFixed = styled.div`
  padding: 26px 16px 28px;
  text-align: center;

  .mark {
    font-size: 28px;
    color: #2f9e63;
    line-height: 1;
    margin-bottom: 8px;
  }

  b {
    display: block;
    font-size: 13.5px;
    margin-bottom: 4px;
  }

  span {
    color: ${s("textSecondary")};
    font-size: 12px;
  }
`;

const UnavailableBody = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px;
  font-size: 12.5px;
  color: ${s("textSecondary")};
`;

const RetryButton = styled.button`
  border: 1px solid ${s("divider")};
  background: ${s("backgroundSecondary")};
  color: ${s("text")};
  border-radius: 5px;
  font-size: 12px;
  padding: 2px 12px;
  cursor: pointer;
  flex: none;

  &:hover {
    background: ${s("backgroundTertiary")};
  }
`;

export default GrammarAssist;
