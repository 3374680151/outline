import * as React from "react";
import styled, { ThemeProvider, keyframes } from "styled-components";
import type { DefaultTheme } from "styled-components";
import { buildDarkTheme } from "@shared/styles/theme";
import Fade from "~/components/Fade";
import env from "~/env";
import { draggableOnDesktop } from "~/styles";
import { Starfield } from "./Starfield";

/**
 * The login pages use a fixed deep-space design regardless of the user's
 * theme, with a blue-cyan accent matching the marketing site. Built from the
 * dark theme so every token (links, input borders, neutral buttons…) derives
 * from the palette automatically.
 */
const loginTheme: DefaultTheme = {
  ...buildDarkTheme({
    accent: "#3f7bff",
    info: "#3f7bff",
  }),
  accentText: "#04122b",
  text: "#f2f7ff",
  textSecondary: "rgba(180, 202, 240, 0.75)",
  textTertiary: "rgba(150, 175, 220, 0.7)",
  placeholder: "rgba(140, 165, 210, 0.55)",
  link: "#9fdcff",
  divider: "rgba(122, 168, 255, 0.18)",
  background: "#0a1026",
  inputBorder: "rgba(122, 168, 255, 0.18)",
  inputBorderFocused: "#5ec8ff",
  inputBackground: "rgba(7, 11, 26, 0.6)",
  buttonNeutralBackground: "rgba(13, 21, 46, 0.55)",
  buttonNeutralHoverBackground: "rgba(20, 30, 62, 0.72)",
  buttonNeutralText: "#dbeaff",
  buttonNeutralBorder: "rgba(122, 168, 255, 0.18)",
};

type Props = {
  children?: React.ReactNode;
};

type MdFragment = {
  kind: "token" | "card";
  text?: string;
  heading?: string;
  lines?: string[];
  top: string;
  left?: string;
  right?: string;
  rotate: number;
  delay: number;
  duration: number;
  blur: number;
  opacity: number;
};

const MD_FRAGMENTS: MdFragment[] = [
  {
    kind: "token",
    text: "# 标题",
    top: "14%",
    left: "8%",
    rotate: -7,
    delay: 0,
    duration: 7.5,
    blur: 0,
    opacity: 0.8,
  },
  {
    kind: "token",
    text: "**重点**",
    top: "66%",
    left: "10%",
    rotate: 5,
    delay: 1.2,
    duration: 8.5,
    blur: 1.2,
    opacity: 0.5,
  },
  {
    kind: "token",
    text: "- [ ] 待办",
    top: "72%",
    right: "13%",
    rotate: -5,
    delay: 2,
    duration: 9,
    blur: 1.4,
    opacity: 0.45,
  },
  {
    kind: "token",
    text: "`代码块`",
    top: "26%",
    right: "9%",
    rotate: 6,
    delay: 0.6,
    duration: 7,
    blur: 0,
    opacity: 0.75,
  },
  {
    kind: "token",
    text: "[链接](url)",
    top: "12%",
    right: "26%",
    rotate: 3,
    delay: 0.3,
    duration: 8,
    blur: 0.6,
    opacity: 0.55,
  },
  {
    kind: "token",
    text: "> 引用",
    top: "48%",
    left: "4%",
    rotate: -10,
    delay: 1.6,
    duration: 10,
    blur: 2,
    opacity: 0.4,
  },
  {
    kind: "card",
    heading: "# 会议记录",
    lines: ["- [ ] 整理要点", "- **行动项** → 指派"],
    top: "68%",
    left: "20%",
    rotate: 4,
    delay: 0.9,
    duration: 9.5,
    blur: 0.8,
    opacity: 0.55,
  },
  {
    kind: "card",
    heading: "# 读书笔记",
    lines: ["- 摘录与想法", "- [ ] 写总结"],
    top: "16%",
    left: "26%",
    rotate: -4,
    delay: 1.5,
    duration: 8.8,
    blur: 0.4,
    opacity: 0.6,
  },
  {
    kind: "card",
    heading: "# 周计划",
    lines: ["- [ ] 复盘", "- 同步目标"],
    top: "58%",
    right: "5%",
    rotate: -6,
    delay: 2.4,
    duration: 10.5,
    blur: 1.6,
    opacity: 0.4,
  },
];

/**
 * Full-page backdrop for the authentication scenes: a deep-space gradient with
 * a starfield, glowing highlights and a copyright line. All children are
 * rendered inside a forced dark blue-cyan theme.
 *
 * @param children The scene content, rendered above the decorative layers.
 */
export function Background({ children }: Props) {
  return (
    <Container>
      <Starfield />
      <Notes aria-hidden="true">
        {MD_FRAGMENTS.map((fragment, index) =>
          fragment.kind === "card" ? (
            <NoteCard
              key={index}
              style={
                {
                  top: fragment.top,
                  left: fragment.left,
                  right: fragment.right,
                  opacity: fragment.opacity,
                  filter: `blur(${fragment.blur}px)`,
                  "--r": `${fragment.rotate}deg`,
                  "--d": `${fragment.duration}s`,
                  "--delay": `${fragment.delay}s`,
                } as React.CSSProperties
              }
            >
              <span className="md-h">{fragment.heading}</span>
              {fragment.lines?.map((line) => (
                <span className="md-li" key={line}>
                  {line}
                </span>
              ))}
            </NoteCard>
          ) : (
            <NoteToken
              key={index}
              style={
                {
                  top: fragment.top,
                  left: fragment.left,
                  right: fragment.right,
                  opacity: fragment.opacity,
                  filter: `blur(${fragment.blur}px)`,
                  "--r": `${fragment.rotate}deg`,
                  "--d": `${fragment.duration}s`,
                  "--delay": `${fragment.delay}s`,
                } as React.CSSProperties
              }
            >
              {fragment.text}
            </NoteToken>
          )
        )}
      </Notes>
      <Copyright aria-hidden="true">
        {env.APP_NAME.toUpperCase()} · WRITE · ORGANIZE · REMEMBER
      </Copyright>
      <ThemeProvider theme={loginTheme}>{children}</ThemeProvider>
    </Container>
  );
}

const Container = styled(Fade)`
  position: relative;
  width: 100vw;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: rgba(180, 202, 240, 0.75);
  background:
    radial-gradient(
      1100px 620px at 18% -8%,
      rgba(94, 200, 255, 0.14),
      transparent 60%
    ),
    radial-gradient(
      900px 600px at 88% 108%,
      rgba(255, 179, 92, 0.1),
      transparent 62%
    ),
    linear-gradient(168deg, #05080f 0%, #070b1c 52%, #0a1026 100%);

  ${draggableOnDesktop()}
`;

const noteFloat = keyframes`
  0%,
  100% {
    transform: translateY(0) rotate(var(--r));
  }
  50% {
    transform: translateY(-16px) rotate(calc(var(--r) * -0.6));
  }
`;

const Notes = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  user-select: none;
`;

const NoteToken = styled.span`
  position: absolute;
  font-family: ${(props) => props.theme.fontFamilyMono};
  font-size: 13px;
  font-weight: 500;
  color: rgba(159, 220, 255, 0.75);
  background: rgba(13, 21, 46, 0.5);
  border: 1px solid rgba(122, 168, 255, 0.22);
  border-radius: 10px;
  padding: 8px 13px;
  animation: ${noteFloat} var(--d) ease-in-out var(--delay) infinite;
  will-change: transform;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const NoteCard = styled.div`
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-family: ${(props) => props.theme.fontFamilyMono};
  background: rgba(13, 21, 46, 0.55);
  border: 1px solid rgba(122, 168, 255, 0.24);
  border-radius: 12px;
  padding: 12px 15px;
  box-shadow: 0 12px 34px rgba(2, 6, 20, 0.45);
  animation: ${noteFloat} var(--d) ease-in-out var(--delay) infinite;
  will-change: transform;

  .md-h {
    font-size: 12.5px;
    font-weight: 600;
    color: #9fdcff;
  }

  .md-li {
    font-size: 11.5px;
    color: rgba(180, 202, 240, 0.6);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Copyright = styled.footer`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  text-align: center;
  padding: 0 20px 22px;
  font-family: ${(props) => props.theme.fontFamilyMono};
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.14em;
  color: rgba(140, 165, 210, 0.4);
  pointer-events: none;
  user-select: none;

  @media (max-width: 720px) {
    display: none;
  }
`;
