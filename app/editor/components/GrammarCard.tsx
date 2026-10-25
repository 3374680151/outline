import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { s } from "@shared/styles";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "~/components/primitives/Popover";
import Flex from "~/components/Flex";
import Text from "~/components/Text";
import {
  grammarCategoryLabel,
  grammarIssueKind,
} from "~/utils/documentGrammar";
import type GrammarCheckExtension from "../extensions/GrammarCheck";
import type { GrammarIssue } from "../extensions/GrammarCheck";

/** Maximum number of replacement suggestions shown, like the official client. */
const MAX_SUGGESTIONS = 5;

/** The community page a rule is documented on. */
const RULE_DOC_URL = "https://community.languagetool.org/rule/show";

/**
 * The correction card shown when an underlined issue is clicked, following
 * the structure of the official LanguageTool client: the message, the
 * replacement suggestions, then the rule actions.
 */
function GrammarCard({ extension }: { extension: GrammarCheckExtension }) {
  const issue = extension.activeIssue;

  // Measured while the card renders so the popover is positioned correctly
  // on its first frame, like the suggestions menu anchors itself.
  const anchor = React.useMemo(() => {
    if (!issue) {
      return { getBoundingClientRect: () => new DOMRect() };
    }
    const rect = extension.measureIssueRect(issue);
    return { getBoundingClientRect: () => rect ?? new DOMRect() };
  }, [extension, issue]);

  return (
    <Popover
      open={!!issue}
      onOpenChange={(open) => {
        if (!open) {
          extension.closeCard();
        }
      }}
    >
      <PopoverAnchor virtualRef={{ current: anchor }} />
      <PopoverContent
        width={340}
        scrollable={false}
        shrink
        sideOffset={6}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {issue && <CardContents extension={extension} issue={issue} />}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The contents of the correction card of one issue.
 */
function CardContents({
  extension,
  issue,
}: {
  extension: GrammarCheckExtension;
  issue: GrammarIssue;
}) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = React.useState(false);

  const kind = grammarIssueKind(issue.match);
  const match = issue.match;
  const replacements = match.replacements
    .map((replacement) => replacement.value)
    .filter((value) => value.length > 0)
    .slice(0, MAX_SUGGESTIONS);

  const docUrl =
    match.ruleUrls[0] ??
    (match.ruleId
      ? `${RULE_DOC_URL}/${match.ruleId}?lang=${
          extension.issueLanguage(issue) ?? "en"
        }`
      : undefined);

  const handleApply = (replacement: string) => {
    const applied = extension.applySuggestion(issue, replacement);

    if (!applied) {
      toast.error(t("The text has changed, please try again"));
    }
  };

  return (
    <Container column>
      <Header align="flex-start" gap={8}>
        <CategoryTag $kind={kind}>{t(grammarCategoryLabel(match))}</CategoryTag>
        <Message size="small">{match.shortMessage || match.message}</Message>
      </Header>

      {replacements.length > 0 && (
        <Suggestions column>
          {replacements.map((replacement) => (
            <Suggestion
              key={replacement}
              onClick={() => handleApply(replacement)}
            >
              {replacement}
            </Suggestion>
          ))}
        </Suggestions>
      )}

      <Actions gap={2}>
        {(match.ruleDescription || docUrl) && (
          <ActionButton onClick={() => setShowDetails(!showDetails)}>
            {t("Learn more")}
          </ActionButton>
        )}
        {match.ruleId && (
          <ActionButton onClick={() => void extension.ignoreRule(issue)}>
            {t("Turn off rule everywhere")}
          </ActionButton>
        )}
        {match.issueType === "misspelling" && (
          <ActionButton onClick={() => void extension.addToDictionary(issue)}>
            {t("Add to dictionary")}
          </ActionButton>
        )}
      </Actions>

      {showDetails && (
        <Details column gap={6}>
          {match.ruleDescription && (
            <Text size="small" type="secondary">
              {match.ruleDescription}
            </Text>
          )}
          {docUrl && (
            <DocLink href={docUrl} target="_blank" rel="noopener noreferrer">
              {t("Open rule documentation")}
            </DocLink>
          )}
        </Details>
      )}
    </Container>
  );
}

const Container = styled(Flex)`
  padding: 4px 8px;
`;

const Header = styled(Flex)`
  padding: 4px 8px 8px;
`;

const CategoryTag = styled.span<{ $kind: "danger" | "success" | "accent" }>`
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

const Message = styled(Text)`
  word-break: break-word;
`;

const Suggestions = styled(Flex)`
  border-top: 1px solid ${s("divider")};
  border-bottom: 1px solid ${s("divider")};
  padding: 4px 0;
`;

const Suggestion = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  padding: 4px 10px;
  border: none;
  background: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  cursor: pointer;

  &:hover {
    background: ${s("listItemHoverBackground")};
    color: ${s("accent")};
  }
`;

const Actions = styled(Flex)`
  padding: 4px 4px 0;
`;

const ActionButton = styled.button`
  border: none;
  background: none;
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: ${s("textSecondary")};
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: ${s("listItemHoverBackground")};
    color: ${s("text")};
  }
`;

const Details = styled(Flex)`
  border-top: 1px solid ${s("divider")};
  margin-top: 8px;
  padding: 8px 8px 4px;
`;

const DocLink = styled.a`
  font-size: 13px;
  color: ${s("accent")};
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

export default observer(GrammarCard);
