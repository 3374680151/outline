import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { GRAMMAR_AUTO_DETECT } from "@shared/constants";
import { s } from "@shared/styles";
import { UserPreference } from "@shared/types";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Text from "~/components/Text";
import { useDocumentContext } from "~/components/DocumentContext";
import Scrollable from "~/components/Scrollable";
import useCurrentUser from "~/hooks/useCurrentUser";
import { client } from "~/utils/ApiClient";
import { grammarIssueKind } from "~/utils/documentGrammar";
import type { GrammarIssue } from "~/editor/extensions/GrammarCheck";
import GrammarCheckExtension from "~/editor/extensions/GrammarCheck";

/** Maximum number of replacement suggestions shown per issue. */
const MAX_SUGGESTIONS = 5;

/** Shared empty issues array so observers without issues do not re-render. */
const EMPTY_ISSUES: GrammarIssue[] = [];

/** A language supported by the grammar service. */
interface GrammarLanguage {
  name: string;
  code: string;
  longCode: string;
}

/** Languages of the grammar service, fetched once per browser session. */
let languagesCache: GrammarLanguage[] | null = null;

/**
 * Lists the grammar issues of the document as cards modeled after the
 * official LanguageTool sidebar: a struck word with a "show in text" link,
 * the context excerpt, replacement suggestions and a way to turn the rule
 * off.
 */
function GrammarPanel() {
  const { t } = useTranslation();
  const context = useDocumentContext();
  const user = useCurrentUser();

  const extension = React.useMemo(
    () =>
      context.editor?.extensions.extensions.find(
        (item): item is GrammarCheckExtension =>
          item instanceof GrammarCheckExtension
      ),
    [context.editor]
  );

  const [languages, setLanguages] = React.useState<GrammarLanguage[] | null>(
    languagesCache
  );

  React.useEffect(() => {
    if (languagesCache) {
      return;
    }

    let alive = true;
    client
      .post<{ data: { languages: GrammarLanguage[] } }>("/grammar.languages")
      .then((res) => {
        languagesCache = res.data.languages;

        if (alive) {
          setLanguages(languagesCache);
        }
      })
      .catch(() => {
        // Without the language list the selector keeps its current value.
      });

    return () => {
      alive = false;
    };
  }, []);

  const issues = extension?.issues ?? EMPTY_ISSUES;
  const autoCheck = user.getPreference(UserPreference.GrammarAutoCheck);
  const checkLanguage = user.getPreference(UserPreference.GrammarLanguage);
  const detectedLanguage =
    checkLanguage === GRAMMAR_AUTO_DETECT
      ? [...(extension?.detectedLanguages.values() ?? [])][0]
      : undefined;
  const characterCount = context.editorDoc?.textContent.length ?? 0;

  const languageOptions: Option[] = React.useMemo(
    () => [
      { type: "item", label: t("Auto detect"), value: GRAMMAR_AUTO_DETECT },
      ...(languages ?? []).map(
        (language) =>
          ({
            type: "item",
            label: language.name,
            value: language.longCode,
          }) satisfies Option
      ),
    ],
    [languages, t]
  );

  const handleLanguageChange = (value: string) => {
    user.setPreference(UserPreference.GrammarLanguage, value);
    void user.save();
  };

  return (
    <PanelBody column>
      <HeaderRow justify="space-between" align="center">
        <Flex align="center" gap={6}>
          <InputSelect
            options={languageOptions}
            value={checkLanguage}
            onChange={handleLanguageChange}
            label={t("Check language")}
            labelHidden
          />
          {detectedLanguage && (
            <Text type="tertiary" size="xsmall">
              {detectedLanguage}
            </Text>
          )}
        </Flex>
        <StatusText type="tertiary" size="xsmall">
          {extension?.status === "loading" ? `${t("Checking")}…` : ""}
          {extension?.status === "error" && extension.error
            ? extension.error
            : ""}
          {extension?.status === "idle" && extension?.incompleteResults
            ? t("Some issues could not be checked")
            : ""}
        </StatusText>
      </HeaderRow>

      <PanelScrollable hiddenScrollbars topShadow>
        <DocumentLike>
          {issues.length > 0 ? (
            <IssueList column gap={16}>
              {issues.map((issue) =>
                extension ? (
                  <IssueCard
                    key={issue.key}
                    issue={issue}
                    extension={extension}
                  />
                ) : null
              )}
            </IssueList>
          ) : extension?.status === "loading" ? (
            <Placeholder>
              <Text type="secondary">{t("Checking")}…</Text>
            </Placeholder>
          ) : (
            <Placeholder>
              <Text type="secondary">
                {t("No issues found")}.
                {` ${t("Issues are underlined in the document as you write.")}`}
              </Text>
            </Placeholder>
          )}
        </DocumentLike>
      </PanelScrollable>

      <Footer justify="space-between" align="center">
        <Text type="tertiary" size="xsmall">
          {t("{{count}} characters", { count: characterCount })}
        </Text>
        {!autoCheck && extension && (
          <Button neutral onClick={() => extension.checkNow()}>
            {t("Check document")}
          </Button>
        )}
      </Footer>
    </PanelBody>
  );
}

type IssueCardProps = {
  issue: GrammarIssue;
  extension: GrammarCheckExtension;
};

function IssueCard({ issue, extension }: IssueCardProps) {
  const { t } = useTranslation();
  const match = issue.match;
  const kind = grammarIssueKind(match);
  const title = match.shortMessage ?? match.message;
  const replacements = match.replacements
    .map((replacement) => replacement.value)
    .filter((value) => value.length > 0)
    .slice(0, MAX_SUGGESTIONS);

  const handleApply = (replacement: string) => {
    const applied = extension.applySuggestion(issue, replacement);

    if (!applied) {
      toast.error(t("The text has changed, please try again"));
    }
  };

  return (
    <Card column gap={8}>
      <CardTitleRow align="center" gap={8}>
        <KindDot $kind={kind} />
        <TitleText size="small">{title}</TitleText>
      </CardTitleRow>
      <InnerCard column gap={8}>
        <Flex align="center" gap={10}>
          <StruckWord $kind={kind}>{issue.text}</StruckWord>
          <ShowInText onClick={() => extension.focusIssue(issue)}>
            {t("Show in text")}
          </ShowInText>
        </Flex>
        {match.context && (
          <Excerpt>
            {match.context.text.slice(0, match.context.offset)}
            <ExcerptWord $kind={kind}>
              {match.context.text.slice(
                match.context.offset,
                match.context.offset + match.context.length
              )}
            </ExcerptWord>
            {match.context.text.slice(
              match.context.offset + match.context.length
            )}
          </Excerpt>
        )}
        {replacements.map((replacement) => (
          <SuggestionButton
            key={replacement}
            onClick={() => handleApply(replacement)}
          >
            {replacement}
          </SuggestionButton>
        ))}
        {match.ruleDescription && (
          <Description type="tertiary" size="xsmall">
            {match.ruleDescription}
          </Description>
        )}
        <ActionsRow gap={12}>
          <LinkButton onClick={() => void extension.ignoreRule(issue)}>
            {t("Turn off rule everywhere")}
          </LinkButton>
          {match.issueType === "misspelling" && (
            <LinkButton onClick={() => void extension.addToDictionary(issue)}>
              {t("Add to dictionary")}
            </LinkButton>
          )}
        </ActionsRow>
      </InnerCard>
    </Card>
  );
}

const PanelBody = styled(Flex)`
  flex: 1;
  min-height: 0;
  gap: 8px;
`;

const HeaderRow = styled(Flex)`
  padding-right: 16px;
  min-height: 32px;
`;

const StatusText = styled(Text)`
  text-align: right;
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

const Card = styled(Flex)`
  padding: 12px;
  border-radius: 8px;
  border: 1px solid ${s("inputBorder")};
  background: ${s("background")};
`;

const CardTitleRow = styled(Flex)``;

const KindDot = styled.span<{ $kind: "danger" | "success" | "accent" }>`
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(props) => props.theme[props.$kind]};
`;

const TitleText = styled(Text)`
  font-weight: 600;
`;

const InnerCard = styled(Flex)`
  padding: 10px;
  border-radius: 6px;
  border: 1px solid ${s("inputBorder")};
  background: ${s("backgroundSecondary")};
`;

const StruckWord = styled.span<{ $kind: "danger" | "success" | "accent" }>`
  color: ${(props) => props.theme[props.$kind]};
  font-weight: 600;
  text-decoration: line-through;
  word-break: break-word;
`;

const ShowInText = styled.button`
  border: 0;
  background: none;
  padding: 0;
  font-size: 13px;
  color: ${s("accent")};
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

const Excerpt = styled.div`
  font-size: 13px;
  line-height: 1.5;
  color: ${s("textSecondary")};
  word-break: break-word;
`;

const ExcerptWord = styled.span<{ $kind: "danger" | "success" | "accent" }>`
  color: ${(props) => props.theme[props.$kind]};
  font-weight: 600;
`;

const SuggestionButton = styled.button`
  border: 0;
  background: ${s("accent")};
  color: ${s("accentText")};
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;

  &:hover {
    filter: brightness(1.08);
  }
`;

const Description = styled(Text)`
  word-break: break-word;
`;

const ActionsRow = styled(Flex)`
  flex-wrap: wrap;
`;

const LinkButton = styled.button`
  border: 0;
  background: none;
  padding: 0;
  font-size: 13px;
  color: ${s("accent")};
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

export default observer(GrammarPanel);
