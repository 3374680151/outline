import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import type { GrammarMatchDTO } from "@shared/types/bilingual";
import { useTranslation } from "react-i18next";
import { GRAMMAR_TYPE_COLOR, GRAMMAR_TYPE_LABEL, matchType } from "~/utils/bilingual/matchType";

/**
 * Props for the grammar issue tooltip.
 */
export interface GrammarTooltipProps {
  /** The grammar match to explain. */
  match: GrammarMatchDTO;
  /** Whether the match can be auto-fixed. */
  canFix: boolean;
  /** Replacement values offered by the rule. */
  replacements: string[];
  /** Position of this issue in the document, e.g. "3/12". */
  positionLabel?: string;
  /** Applies a replacement. */
  onFix: (value: string) => void;
  /** Skips this occurrence only, keeping the rule active. */
  onSkip: () => void;
  /** Ignores the rule for this user. */
  onIgnore: () => void;
  /** Closes the tooltip. */
  onClose: () => void;
}

/**
 * Fix card for a single grammar issue, modeled on LanguageTool's review
 * card: a type chip, one explanation line, replacement chips, and a compact
 * action row. Deliberately minimal — the surrounding editor is the context.
 */
export function GrammarTooltip({
  match,
  canFix,
  replacements,
  positionLabel,
  onFix,
  onSkip,
  onIgnore,
  onClose,
}: GrammarTooltipProps) {
  const { t } = useTranslation();

  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick, true);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick, true);
    };
  }, [onClose]);

  const type = matchType(match);
  const categoryColor = GRAMMAR_TYPE_COLOR[type];
  const typeLabel = GRAMMAR_TYPE_LABEL[type];

  return (
    <Card ref={containerRef} role="dialog" aria-label={t("Grammar issue")} data-testid="grammar-tooltip">
      <Header>
        <TypeBadge $color={categoryColor}>{typeLabel}</TypeBadge>
        <CategoryName>{match.shortMessage ?? match.rule.category.name}</CategoryName>
        {positionLabel && <Position>{positionLabel}</Position>}
        <CloseButton onClick={onClose} aria-label={t("Close")}>
          ✕
        </CloseButton>
      </Header>
      <Message>{match.message}</Message>
      {canFix && replacements.length > 0 && (
        <Replacements>
          {replacements.slice(0, 4).map((value, index) => (
            <FixButton
              key={value}
              data-testid="grammar-fix"
              $recommended={index === 0}
              onClick={() => onFix(value)}
            >
              {value}
            </FixButton>
          ))}
        </Replacements>
      )}
      {!canFix && (
        <Hint>{t("This issue spans formatting and cannot be auto-fixed")}</Hint>
      )}
      <Footer>
        <GhostButton onClick={onSkip}>{t("Skip once")}</GhostButton>
        <GhostButton onClick={onIgnore}>{t("Ignore rule")}</GhostButton>
      </Footer>
    </Card>
  );
}

export default GrammarTooltip;

const Card = styled.div`
  width: 360px;
  background: ${s("background")};
  color: ${s("text")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.55;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
`;

const TypeBadge = styled.span<{ $color: string }>`
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 99px;
  padding: 1px 8px;
  flex: none;
  background: ${(props) => props.$color}1f;
  color: ${(props) => props.$color};
`;

const CategoryName = styled.span`
  font-weight: 600;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Position = styled.span`
  color: ${s("textTertiary")};
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex: none;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  padding: 2px 4px;
  flex: none;
`;

const Message = styled.div`
  margin-bottom: 8px;
  word-break: break-word;
`;

const Replacements = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
`;

const FixButton = styled.button<{ $recommended: boolean }>`
  background: ${(props) => (props.$recommended ? s("accent") : s("backgroundSecondary"))};
  color: ${(props) => (props.$recommended ? "#fff" : s("text"))};
  border: 1px solid ${(props) => (props.$recommended ? s("accent") : s("divider"))};
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Hint = styled.div`
  color: ${s("textSecondary")};
  font-size: 12px;
  margin-bottom: 8px;
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid ${s("divider")};
  padding-top: 8px;
`;

const GhostButton = styled.button`
  background: none;
  border: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  font-size: 12px;

  &:hover {
    color: ${s("text")};
  }
`;
