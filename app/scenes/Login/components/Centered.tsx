import * as React from "react";
import styled, { keyframes } from "styled-components";
import Flex from "@shared/components/Flex";
import { LoginCats } from "./LoginCats";

type CatsStatus = "idle" | "watch" | "error" | "happy";

type Props = React.ComponentProps<typeof Flex> & {
  /** Mood for the cats peeking over the panel edge. */
  catsStatus?: CatsStatus;
};

/**
 * Centered authentication panel: a dark glass card with a gradient border
 * ring, with the login cats peeking over its top edge.
 *
 * @param children The panel content.
 * @param catsStatus Mood for the cats, defaults to idle.
 * @param rest Props forwarded to the outer flex column.
 */
export function Centered({ children, catsStatus, gap, ...rest }: Props) {
  return (
    <StyledCentered {...rest}>
      <LoginCats status={catsStatus} />
      <Panel $gap={gap}>{children}</Panel>
    </StyledCentered>
  );
}

const panelRise = keyframes`
  from {
    opacity: 0;
    transform: translateY(26px);
  }
`;

const StyledCentered = styled(Flex).attrs({
  align: "center",
  justify: "center",
  column: true,
  auto: true,
})`
  user-select: none;
  position: relative;
  z-index: 1;
  flex: 0 1 auto;
  width: min(90vw, 480px);
  margin: 0 auto;
`;

const Panel = styled.div<{ $gap?: number }>`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${(props) => (props.$gap !== undefined ? `${props.$gap}px` : "12px")};
  width: 100%;
  color: #dbeaff;
  font-family:
    "Space Grotesk", "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI",
    sans-serif;
  background: linear-gradient(
    150deg,
    rgba(20, 30, 62, 0.72),
    rgba(9, 14, 34, 0.82)
  );
  border: 1px solid rgba(122, 168, 255, 0.18);
  border-radius: 24px;
  padding: clamp(24px, 5vw, 36px);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  box-shadow:
    0 30px 90px rgba(2, 6, 20, 0.6),
    inset 0 1px 0 rgba(160, 200, 255, 0.12);
  animation: ${panelRise} 0.7s cubic-bezier(0.22, 1, 0.36, 1) backwards;

  /* Gradient border ring, painted just outside the panel edge. */
  &::before {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: 24px;
    padding: 1px;
    background: linear-gradient(
      120deg,
      rgba(94, 200, 255, 0.4),
      transparent 34%,
      transparent 66%,
      rgba(255, 179, 92, 0.32)
    );
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
  }

  h1,
  h2 {
    font-family:
      "Space Grotesk", "Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI",
      sans-serif;
    font-weight: 800;
    font-size: clamp(21px, 3vw, 24px);
    letter-spacing: 0.02em;
    background: linear-gradient(94deg, #eaf4ff 10%, #8fd4ff 55%, #ffd0a0 95%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  button {
    border-radius: 13px;
  }

  button[data-variant="primary"] {
    background: linear-gradient(96deg, #3f7bff, #5ec8ff 55%, #7fd0ff);
    color: #04122b;
    font-weight: 700;
    border: none;
    box-shadow:
      0 10px 30px rgba(63, 123, 255, 0.35),
      inset 0 1px 0 rgba(255, 255, 255, 0.35);
    transition:
      transform 0.18s ease,
      box-shadow 0.18s ease,
      filter 0.18s ease;
  }

  button[data-variant="primary"]:hover:not(:disabled),
  button[data-variant="primary"][aria-expanded="true"] {
    background: linear-gradient(96deg, #3f7bff, #5ec8ff 55%, #7fd0ff);
    transform: translateY(-1px);
    box-shadow:
      0 14px 38px rgba(63, 123, 255, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.35);
  }

  button[data-variant="primary"]:disabled {
    filter: saturate(0.5) brightness(0.8);
  }

  button[data-variant="neutral"] {
    background: rgba(13, 21, 46, 0.55);
    border: 1px solid rgba(122, 168, 255, 0.18);
    box-shadow: none;
  }

  button[data-variant="neutral"]:hover:not(:disabled),
  button[data-variant="neutral"][aria-expanded="true"] {
    background: rgba(20, 30, 62, 0.72);
  }

  /* Softer corners for the input fields, matching the reference panel. */
  div:has(> input) {
    border-radius: 13px;
  }
`;
