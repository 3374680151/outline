import { observer } from "mobx-react";
import { CheckmarkIcon, CloseIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { keyframes, type DefaultTheme } from "styled-components";
import { s } from "@shared/styles";
import type {
  ProofreadCategory,
  ProofreadSuggestion,
} from "@shared/types/proofread";
import Text from "~/components/Text";

/** Presentation state of the panel. */
export type ProofreadPanelState = "loading" | "done" | "error";

/** Props for the proofread suggestion panel. */
export interface ProofreadPanelProps {
  /** Whether the check is running, finished, or failed. */
  status: ProofreadPanelState;
  /** The validated suggestions, shown as cards. */
  suggestions: ProofreadSuggestion[];
  /** Error message when status is "error". */
  error?: string;
  /** Whether no proofread model is configured for the workspace. */
  unconfigured?: boolean;
  /** The 1-based index of the block being checked, for the title. */
  blockIndex: number;
  /** Applies one suggestion to the source text. */
  onAccept: (suggestion: ProofreadSuggestion) => void;
  /** Dismisses one suggestion without changing the text. */
  onIgnore: (suggestion: ProofreadSuggestion) => void;
  /** Re-runs the check for the same block. */
  onRetry: () => void;
  /** Closes the panel. */
  onClose: () => void;
}

/** Display metadata per suggestion category; colors are theme token names. */
const CATEGORY_META: Record<
  ProofreadCategory,
  {
    label: string;
    color: keyof DefaultTheme;
  }
> = {
  spelling: {
    label: "spelling",
    color: "danger",
  },
  grammar: {
    label: "grammar",
    color: "accent",
  },
  punctuation: {
    label: "punctuation",
    color: "noticeWarningText",
  },
  style: {
    label: "style",
    color: "noticeInfoText",
  },
  word_choice: {
    label: "word choice",
    color: "noticeSuccessText",
  },
};

/**
 * Floating panel listing the proofread suggestions for one block, following
 * the FluentRead-Go proofread design: category tag, verbatim fragment with
 * the fix, a teaching reason, and per-item accept/ignore.
 */
export const ProofreadPanel = observer(function ProofreadPanel({
  status,
  suggestions,
  error,
  unconfigured,
  blockIndex,
  onAccept,
  onIgnore,
  onRetry,
  onClose,
}: ProofreadPanelProps) {
  const { t } = useTranslation();
  const ref = React.useRef<HTMLDivElement | null>(null);

  // Close on Escape; the editor regains focus through the extension.
  React.useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;

      if (ref.current && target && !ref.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeydown, true);
    document.addEventListener("mousedown", handlePointerDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeydown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [onClose]);

  return (
    <Panel
      ref={ref}
      role="dialog"
      aria-label={t("Grammar check")}
      aria-live="polite"
    >
      <Header>
        <Title>
          {t("Grammar check")} · {t("block {{index}}", { index: blockIndex })}
        </Title>
        <CloseButton
          type="button"
          onClick={onClose}
          aria-label={t("Close")}
        >
          <CloseIcon size={16} />
        </CloseButton>
      </Header>

      <Body>
        {status === "loading" && (
          <>
            <SkeletonLine />
            <SkeletonLine />
            <SkeletonLine short />
            <LoadingText>{t("Checking…")}</LoadingText>
          </>
        )}

        {status === "error" && (
          <ErrorBox>
            <Text>{error ?? t("Connection test failed")}</Text>
            <PanelButton type="button" onClick={onRetry}>
              {t("Retry")}
            </PanelButton>
          </ErrorBox>
        )}

        {status === "done" && unconfigured && (
          <EmptyBox>
            <Text>{t("No proofread model is configured yet.")}</Text>
            <Text type="secondary">
              {t("Add one in Settings → AI services → Model providers.")}
            </Text>
          </EmptyBox>
        )}

        {status === "done" &&
          !unconfigured &&
          suggestions.length === 0 && (
            <EmptyBox>
              <OkIconWrap>
                <CheckmarkIcon size={16} color="currentColor" />
              </OkIconWrap>
              <Text>{t("No problems found")}</Text>
            </EmptyBox>
          )}

        {suggestions.map((suggestion) => (
          <SuggestionCard
            key={`${suggestion.original}→${suggestion.suggestion}`}
            suggestion={suggestion}
            onAccept={onAccept}
            onIgnore={onIgnore}
          />
        ))}
      </Body>
    </Panel>
  );
});

/** One suggestion card with the category tag, diff, and reason. */
const SuggestionCard = observer(function SuggestionCard({
  suggestion,
  onAccept,
  onIgnore,
}: {
  suggestion: ProofreadSuggestion;
  onAccept: (suggestion: ProofreadSuggestion) => void;
  onIgnore: (suggestion: ProofreadSuggestion) => void;
}) {
  const { t } = useTranslation();
  const meta = CATEGORY_META[suggestion.category];

  const handleAccept = React.useCallback(() => {
    onAccept(suggestion);
  }, [onAccept, suggestion]);

  const handleIgnore = React.useCallback(() => {
    onIgnore(suggestion);
  }, [onIgnore, suggestion]);

  return (
    <Card>
      <CategoryTag color={meta.color}>{t(meta.label)}</CategoryTag>
      <Diff>
        <Original>{suggestion.original}</Original>
        <Arrow>→</Arrow>
        <Fix>{suggestion.suggestion}</Fix>
      </Diff>
      <Reason>{suggestion.reason}</Reason>
      <CardActions>
        <PanelButton
          type="button"
          $accent
          onClick={handleAccept}
          aria-label={t("Apply suggestion: {{summary}}", {
            summary: `${suggestion.original} → ${suggestion.suggestion}`,
          })}
        >
          {t("Accept")}
        </PanelButton>
        <PanelButton type="button" onClick={handleIgnore}>
          {t("Ignore")}
        </PanelButton>
      </CardActions>
    </Card>
  );
});

const panelIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const shimmer = keyframes`
  0% {
    background-position: -200px 0;
  }
  100% {
    background-position: 200px 0;
  }
`;

const Panel = styled.div`
  width: 420px;
  max-width: calc(100vw - 24px);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  animation: ${panelIn} 180ms ease-out;

  @media (prefers-reduced-motion: reduce) {
    animation-duration: 1ms;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid ${s("divider")};
  flex-shrink: 0;
`;

const Title = styled.span`
  font-size: 13px;
  font-weight: 600;
`;

const CloseButton = styled.button`
  border: none;
  background: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;

  &:hover {
    color: ${s("text")};
  }
`;

const Body = styled.div`
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SkeletonLine = styled.div<{ short?: boolean }>`
  height: 12px;
  border-radius: 6px;
  ${(props) => (props.short ? "width: 60%;" : "")}
  background: linear-gradient(
    90deg,
    ${s("backgroundSecondary")} 25%,
    ${s("backgroundTertiary")} 50%,
    ${s("backgroundSecondary")} 75%
  );
  background-size: 400px 100%;
  animation: ${shimmer} 1.4s ease-in-out infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const LoadingText = styled(Text)`
  font-size: 12.5px;
  color: ${s("textSecondary")};
`;

const ErrorBox = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
`;

const EmptyBox = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  font-size: 13px;
`;

const OkIconWrap = styled.span`
  color: ${s("noticeSuccessText")};
  display: flex;
`;

const Card = styled.div`
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const CategoryTag = styled.span<{ color: keyof DefaultTheme }>`
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  padding: 1px 6px;
  color: #fff;
  background: ${(props) => s(props.color)(props)};
`;

const Diff = styled.div`
  font-size: 13.5px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
`;

const Original = styled.span`
  text-decoration: line-through;
  color: ${s("danger")};
`;

const Arrow = styled.span`
  color: ${s("textTertiary")};
`;

const Fix = styled.span`
  color: ${s("noticeSuccessText")};
  font-weight: 600;
`;

const Reason = styled.p`
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: ${s("textSecondary")};
`;

const CardActions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;

/**
 * A plain styled button. The panel mounts outside the React tree (no
 * ActionContextProvider), so the shared Button component cannot be used
 * here.
 */
const PanelButton = styled.button<{ $accent?: boolean }>`
  border: 1px solid
    ${(props) => (props.$accent ? "transparent" : s("divider"))};
  background: ${(props) =>
    props.$accent ? props.theme.accent : s("backgroundSecondary")};
  color: ${(props) => (props.$accent ? "#fff" : s("text"))};
  border-radius: 6px;
  font-size: 13px;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 150ms ease-in-out;

  &:hover {
    background: ${(props) =>
      props.$accent ? props.theme.accent : s("backgroundTertiary")};
    color: ${(props) => (props.$accent ? "#fff" : s("text"))};
  }
`;
