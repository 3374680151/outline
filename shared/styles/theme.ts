import { darken, lighten, mix, saturate, transparentize } from "polished";
import type { DefaultTheme, Colors } from "styled-components";
import { breakpoints } from "./breakpoint";

const defaultColors: Colors = {
  transparent: "transparent",
  almostBlack: "#111319",
  lightBlack: "#2F3336",
  almostWhite: "#E6E6E6",
  veryDarkBlue: "#08090C",
  slate: "#8F959E",
  slateLight: "#DEE0E3",
  slateDark: "#646A73",
  smoke: "#F5F6F7",
  smokeLight: "#F9FAFB",
  smokeDark: "#E5E6EB",
  white: "#FFFFFF",
  white05: "rgba(255, 255, 255, 0.05)",
  white10: "rgba(255, 255, 255, 0.1)",
  white50: "rgba(255, 255, 255, 0.5)",
  white75: "rgba(255, 255, 255, 0.75)",
  black: "#000",
  black05: "rgba(0, 0, 0, 0.05)",
  black10: "rgba(0, 0, 0, 0.1)",
  black50: "rgba(0, 0, 0, 0.50)",
  black75: "rgba(0, 0, 0, 0.75)",
  accent: "#3370FF",
  yellow: "#FFC60A",
  warmGrey: "#F2F3F5",
  danger: "#F54A45",
  warning: "#FF8800",
  success: "#34C724",
  info: "#3370FF",
  brand: {
    red: "#F54A45",
    pink: "#F5316C",
    purple: "#7F3BF5",
    blue: "#3370FF",
    marine: "#04B49C",
    dusk: "#4E5CF6",
    green: "#34C724",
    yellow: "#FFC60A",
  },
};

/** The narrowest the content of a sidebar can be, excluding its padding. */
const sidebarMinWidth = 240;

const sidebarPadding = 16;

const spacing = {
  sidebarWidth: 260,
  sidebarRightWidth: 360,
  sidebarCollapsedWidth: 16,
  sidebarMinWidth,
  sidebarMaxWidth: 500,
  /** The narrowest a sidebar can be resized to, including its padding. */
  sidebarResizeMinWidth: sidebarMinWidth + sidebarPadding,
};

/** Soft elevation for comment bubbles and similar inline cards. */
const commentShadowLight = "0 2px 8px rgba(31, 35, 41, 0.06)";
const commentShadowDark = "0 2px 8px rgba(0, 0, 0, 0.3)";

const buildBaseTheme = (input: Partial<Colors>) => {
  const colors = {
    ...defaultColors,
    ...input,
  };

  return {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, Inter, 'Segoe UI', Roboto, Oxygen, sans-serif",
    fontFamilyMono:
      "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace",
    fontFamilyEmoji:
      "Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol, Segoe UI, Twemoji Mozilla, Noto Color Emoji, Android Emoji",
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    accentText: colors.white,
    selected: colors.accent,
    textHighlight: "#FDEA9B",
    textHighlightForeground: colors.almostBlack,
    commentMarkBackground: transparentize(0.5, colors.brand.marine),
    commentedImageOutlineDark: colors.brand.marine,
    commentedImageOutlineLight: transparentize(0.7, colors.brand.marine),
    code: colors.lightBlack,
    codeComment: "#008000",
    codePunctuation: "#393a34",
    codeNumber: "#0550ae",
    codeProperty: "#ff0000",
    codeTag: "#800000",
    codeClassName: "#00578a",
    codeString: "#a31515",
    codeSelector: "#800000",
    codeAttrName: "#ff0000",
    codeAttrValue: colors.lightBlack,
    codeEntity: "#ff0000",
    codeKeyword: "#00009f",
    codeFunction: "#393A34",
    codeStatement: "#ff0000",
    codePlaceholder: "#3d8fd1",
    codeInserted: "#0550ae",
    codeImportant: "#e90e90",
    codeConstant: "#0550ae",
    codeParameter: colors.lightBlack,
    codeOperator: "#393a34",
    noticeInfoBackground: colors.slate,
    noticeInfoText: saturate(0.1, mix(0.5, colors.slate, colors.almostBlack)),
    noticeTipBackground: colors.brand.blue,
    noticeTipText: saturate(
      0.1,
      mix(0.5, colors.brand.blue, colors.almostBlack)
    ),
    noticeWarningBackground: colors.brand.yellow,
    noticeWarningText: saturate(
      0.1,
      mix(0.5, colors.brand.yellow, colors.almostBlack)
    ),
    noticeSuccessBackground: colors.brand.green,
    noticeSuccessText: saturate(
      0.1,
      mix(0.5, colors.brand.green, colors.almostBlack)
    ),
    tableSelectedBackground: transparentize(0.9, colors.accent),
    breakpoints,
    ...colors,
    ...spacing,
  };
};

export const buildLightTheme = (input: Partial<Colors>): DefaultTheme => {
  const colors = buildBaseTheme(input);

  return {
    ...colors,
    isDark: false,
    background: colors.white,
    backgroundSecondary: colors.warmGrey,
    backgroundTertiary: "#E5E6EB",
    backgroundQuaternary: darken(0.05, "#E5E6EB"),
    link: colors.accent,
    cursor: colors.almostBlack,
    text: "#1F2329",
    textSecondary: "#646A73",
    textTertiary: "#8F959E",
    textDiffInserted: colors.almostBlack,
    textDiffInsertedBackground: "rgba(18, 138, 41, 0.16)",
    textDiffDeleted: "#646A73",
    textDiffDeletedBackground: "rgba(255, 180, 173, 0.25)",
    placeholder: "#BBBFC4",
    sidebarBackground: "#F2F3F5",
    sidebarHoverBackground: "#E5E6EB",
    sidebarActiveBackground: "#E1EFFF",
    sidebarControlHoverBackground: "rgba(31, 35, 41, 0.1)",
    sidebarDraftBorder: "#C9CDD4",
    sidebarText: "#1F2329",
    backdrop: "rgba(0, 0, 0, 0.2)",
    shadow: "rgba(0, 0, 0, 0.2)",

    modalBackdrop: "rgba(0, 0, 0, 0.25)",
    modalBackground: colors.white,
    modalShadow: "0 0 1px rgba(0, 0, 0, 0.3), 0 4px 14px rgba(0, 0, 0, 0.1)",

    menuItemSelected: colors.warmGrey,
    menuBackground: colors.white,
    menuShadow: "0 0 1px rgba(0, 0, 0, 0.3), 0 4px 14px rgba(0, 0, 0, 0.1)",
    commentShadow: commentShadowLight,
    divider: colors.slateLight,
    titleBarDivider: colors.slateLight,
    inputBorder: colors.slateLight,
    inputBorderFocused: colors.accent,
    inputBackground: colors.warmGrey,
    listItemHoverBackground: colors.warmGrey,
    mentionBackground: colors.warmGrey,
    mentionHoverBackground: "#E5E6EB",
    tableSelected: colors.accent,
    buttonNeutralBackground: colors.white,
    buttonNeutralHoverBackground: colors.warmGrey,
    buttonNeutralText: colors.almostBlack,
    buttonNeutralBorder: "#DEE0E3",
    tooltipBackground: colors.almostBlack,
    tooltipText: colors.white,
    toastBackground: colors.white,
    toastText: colors.almostBlack,
    quote: colors.slateLight,
    codeBackground: colors.smoke,
    codeBorder: colors.smokeDark,
    embedBorder: colors.slateLight,
    horizontalRule: colors.smokeDark,
    progressBarBackground: colors.slateLight,
    scrollbarBackground: colors.smoke,
    scrollbarThumb: darken(0.15, colors.smokeDark),
  };
};

export const buildDarkTheme = (input: Partial<Colors>): DefaultTheme => {
  const colors = buildBaseTheme(input);

  return {
    ...colors,
    isDark: true,
    background: "#1D2129",
    backgroundSecondary: "#22262E",
    backgroundTertiary: "#2B2F38",
    backgroundQuaternary: lighten(0.1, "#2B2F38"),
    link: colors.accent,
    text: "rgba(255, 255, 255, 0.86)",
    cursor: "rgba(255, 255, 255, 0.86)",
    textSecondary: "rgba(255, 255, 255, 0.62)",
    textTertiary: "rgba(255, 255, 255, 0.40)",
    textDiffInserted: colors.almostWhite,
    textDiffInsertedBackground: "rgba(63,185,80,0.25)",
    textDiffDeleted: darken(0.1, colors.almostWhite),
    textDiffDeletedBackground: "rgba(248,81,73,0.15)",
    placeholder: "rgba(255, 255, 255, 0.28)",
    sidebarBackground: "#16181D",
    sidebarHoverBackground: "#23262C",
    sidebarActiveBackground: "rgba(51, 112, 255, 0.20)",
    sidebarControlHoverBackground: colors.white10,
    sidebarDraftBorder: "rgba(255, 255, 255, 0.20)",
    sidebarText: "rgba(255, 255, 255, 0.78)",
    backdrop: "rgba(0, 0, 0, 0.5)",
    shadow: "rgba(0, 0, 0, 0.6)",

    modalBackdrop: colors.black50,
    modalBackground: "#22262E",
    modalShadow:
      "0 0 0 1px rgba(0, 0, 0, 0.1), 0 8px 16px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.08)",

    menuItemSelected: "rgba(255, 255, 255, 0.08)",
    menuBackground: "#22262E",
    menuShadow:
      "0 0 0 1px rgb(34 40 52), 0 8px 16px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.08)",
    commentShadow: commentShadowDark,
    divider: "rgba(255, 255, 255, 0.10)",
    titleBarDivider: "rgba(255, 255, 255, 0.08)",
    inputBorder: "rgba(255, 255, 255, 0.16)",
    inputBorderFocused: colors.accent,
    inputBackground: "#2B2F38",
    listItemHoverBackground: "rgba(255, 255, 255, 0.08)",
    mentionBackground: "rgba(51, 112, 255, 0.15)",
    mentionHoverBackground: "rgba(51, 112, 255, 0.25)",
    tableSelected: colors.accent,
    buttonNeutralBackground: "#22262E",
    buttonNeutralHoverBackground: "#2B2F38",
    buttonNeutralText: colors.white,
    buttonNeutralBorder: "rgba(255, 255, 255, 0.16)",
    tooltipBackground: colors.white,
    tooltipText: colors.lightBlack,
    toastBackground: "#22262E",
    toastText: colors.almostWhite,
    quote: "rgba(255, 255, 255, 0.20)",
    code: colors.almostWhite,
    codeBackground: "#16181D",
    codeBorder: colors.white10,
    codeComment: "#6a9955",
    codePunctuation: "#b3b3b3",
    codeProperty: "#b5cea8",
    codeNumber: "#b5cea8",
    codeTag: "#b5cea8",
    codeOperator: "#d4d4d4",
    codeConstant: "#9cdcfe",
    codeParameter: "#9cdcfe",
    codeSelector: "#ce9178",
    codeEntity: "#d4d4d4",
    codeStatement: "#d16969",
    codeInserted: "#b5cea8",
    codeString: "#ce9178",
    codeKeyword: "#569Cd6",
    codeFunction: "#dcdcaa",
    codeClassName: "#4ec9b0",
    codeImportant: "#569Cd6",
    codeAttrName: "#9cdcfe",
    codeAttrValue: "#ce9178",
    embedBorder: colors.black50,
    horizontalRule: lighten(0.1, colors.almostBlack),
    noticeInfoText: mix(0.5, colors.slate, colors.white),
    noticeTipText: mix(0.5, colors.brand.blue, colors.white),
    noticeWarningText: mix(0.5, colors.brand.yellow, colors.white),
    noticeSuccessText: mix(0.5, colors.brand.green, colors.white),
    progressBarBackground: colors.slate,
    scrollbarBackground: colors.black,
    scrollbarThumb: colors.lightBlack,
  };
};

export const buildPitchBlackTheme = (input: Partial<Colors>) => {
  const colors = buildDarkTheme(input);

  return {
    ...colors,
    background: colors.black,
    codeBackground: colors.almostBlack,
  };
};

export const light = buildLightTheme(defaultColors);

export default light as DefaultTheme;
