import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import type { GrammarMatchDTO } from "@shared/types/bilingual";
import { useTranslation } from "react-i18next";
import { GRAMMAR_TYPE_COLOR, matchType } from "~/utils/bilingual/matchType";

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
  /** Applies a replacement. */
  onFix: (value: string) => void;
  /** Ignores the rule for this user. */
  onIgnore: () => void;
  /** Closes the tooltip. */
  onClose: () => void;
}

/**
 * Detail card for a single grammar issue: category, explanation, context
 * with the issue highlighted, replacement actions, and rule ignore.
 */
export function GrammarTooltip({
  match,
  canFix,
  replacements,
  onFix,
  onIgnore,
  onClose,
}: GrammarTooltipProps) {
  const { t } = useTranslation();

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const type = matchType(match);
  const categoryColor = GRAMMAR_TYPE_COLOR[type];
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  const context = match.context;

  return (
    <Card role="dialog" aria-label={t("Grammar issue")}>
      <Header>
        <CategoryDot $color={categoryColor} />
        <CategoryName>
          {match.shortMessage ?? match.rule.category.name}
        </CategoryName>
        <TypeBadge $color={categoryColor}>{typeLabel}</TypeBadge>
        <CloseButton onClick={onClose} aria-label={t("Close")}>
          ✕
        </CloseButton>
      </Header>
      <Message>{match.message}</Message>
      <RuleId>{match.rule.id}</RuleId>
      {context.text && (
        <Context>
          {context.text.slice(0, context.offset)}
          <Mark $color={categoryColor}>
            {context.text.slice(context.offset, context.offset + context.length)}
          </Mark>
          {context.text.slice(context.offset + context.length)}
        </Context>
      )}
      {canFix && replacements.length > 0 && (
        <Replacements>
          {replacements.slice(0, 4).map((value) => (
            <FixButton key={value} onClick={() => onFix(value)}>
              {value}
            </FixButton>
          ))}
        </Replacements>
      )}
      {!canFix && (
        <Hint>{t("This issue spans formatting and cannot be auto-fixed")}</Hint>
      )}
      <Footer>
        <IgnoreButton onClick={onIgnore}>{t("Ignore this rule")}</IgnoreButton>
      </Footer>
    </Card>
  );
}

export default GrammarTooltip;

const Card = styled.div`
  width: 320px;
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
  gap: 6px;
  margin-bottom: 6px;
`;

const CategoryDot = styled.span<{ $color: string }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(props) => props.$color};
  flex-shrink: 0;
`;

const CategoryName = styled.span`
  font-weight: 600;
  flex: 1;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  padding: 2px 4px;
`;

const Message = styled.div`
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

const RuleId = styled.div`
  font-family: ui-monospace, Menlo, monospace;
  font-size: 10.5px;
  color: ${s("textTertiary")};
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Context = styled.div`
  background: ${s("backgroundSecondary")};
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  word-break: break-word;
`;

const Mark = styled.span<{ $color: string }>`
  text-decoration: underline wavy ${(props) => props.$color};
  text-underline-offset: 3px;
  font-weight: 600;
`;

const Replacements = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
`;

const FixButton = styled.button`
  background: ${s("accent")};
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
`;

const Hint = styled.div`
  color: ${s("textSecondary")};
  font-size: 12px;
  margin-bottom: 8px;
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const IgnoreButton = styled.button`
  background: none;
  border: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  font-size: 12px;
  text-decoration: underline;
`;
