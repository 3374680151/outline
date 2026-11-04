import { CheckmarkIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled, { keyframes } from "styled-components";
import { s } from "@shared/styles";

/** Props for the proofread status badge. */
export interface ProofreadBadgeProps {
  /** The number of pending issues across checked blocks. */
  issues: number;
  /** Whether a check request is in flight. */
  checking: boolean;
  /** Opens the summary panel. */
  onClick: () => void;
}

/**
 * A circular status badge pinned to the bottom-right corner of the editor
 * pane while proofread mode is enabled: a spinner while a check runs, the
 * pending issue count, or a checkmark when the checked text is clean.
 */
export const ProofreadBadge = React.memo(function ProofreadBadge({
  issues,
  checking,
  onClick,
}: ProofreadBadgeProps) {
  const { t } = useTranslation();

  return (
    <Badge
      type="button"
      $hasIssues={issues > 0}
      onClick={onClick}
      aria-label={t("Grammar check")}
      title={t("Grammar check")}
    >
      {checking ? (
        <Spinner />
      ) : issues > 0 ? (
        <Count>{issues > 99 ? "99+" : issues}</Count>
      ) : (
        <CheckmarkIcon size={16} color="currentColor" />
      )}
    </Badge>
  );
});

const spin = keyframes`
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
`;

const Badge = styled.button<{ $hasIssues?: boolean }>`
  position: fixed;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid
    ${(props) => (props.$hasIssues ? "transparent" : s("divider"))};
  background: ${(props) =>
    props.$hasIssues ? props.theme.accent : s("background")};
  color: ${(props) => (props.$hasIssues ? "#fff" : s("noticeSuccessText"))};
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  padding: 0;
  transition: transform 100ms ease-in-out;

  &:hover {
    transform: scale(1.05);
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;

    &:hover {
      transform: none;
    }
  }
`;

const Count = styled.span`
  line-height: 1;
`;

const Spinner = styled.span`
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid ${s("backgroundTertiary")};
  border-top-color: ${s("accent")};
  animation: ${spin} 800ms linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation-duration: 3s;
  }
`;
