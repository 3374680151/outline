import * as React from "react";
import styled, { ThemeProvider } from "styled-components";
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
  textTertiary: "rgba(150, 175, 220, 0.5)",
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
      <Copyright aria-hidden="true">
        {env.APP_NAME.toUpperCase()} · CONNECT EVERY IDEA
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
