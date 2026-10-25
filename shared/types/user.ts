/** Sidebar sections that a user can reorder. */
export enum SidebarSection {
  /** The starred documents section. */
  Starred = "starred",
  /** The documents shared with the user directly or via groups. */
  SharedWithMe = "shared",
  /** The collections section. */
  Collections = "collections",
  /** The user's own personal documents section. */
  Personal = "personal",
}

/** User-level preferences. */
export enum UserPreference {
  /** Whether reopening the app should redirect to the last viewed document. */
  RememberLastPath = "rememberLastPath",
  /** If web-style hand pointer should be used on interactive elements. */
  UseCursorPointer = "useCursorPointer",
  /** Whether code blocks should show line numbers. */
  CodeBlockLineNumers = "codeBlockLineNumbers",
  /** Whether documents have a separate edit mode instead of always editing. */
  SeamlessEdit = "seamlessEdit",
  /** Whether documents should start in full-width mode. */
  FullWidthDocuments = "fullWidthDocuments",
  /** Whether to sort the comments by their order in the document. */
  SortCommentsByOrderInDocument = "sortCommentsByOrderInDocument",
  /** Whether to display a comment indicator in the gutter beside commented lines. */
  CommentsInGutter = "commentsInGutter",
  /** Whether smart text replacements should be enabled. */
  EnableSmartText = "enableSmartText",
  /** Whether live word, character, and paragraph counts are shown in documents. */
  ShowDocumentStats = "showDocumentStats",
  /** The style of notification badge to display. */
  NotificationBadge = "notificationBadge",
  /** The display order of the reorderable sections in the sidebar. */
  SidebarSectionOrder = "sidebarSectionOrder",
  /** The source language used by the translation panel, auto when unset. */
  TranslationSourceLanguage = "translationSourceLanguage",
  /** The target language used by the translation panel. */
  TranslationTargetLanguage = "translationTargetLanguage",
  /** The language grammar checking runs against, auto-detect when unset. */
  GrammarLanguage = "grammarLanguage",
  /** The native language of the user, enables false-friend hints. */
  GrammarMotherTongue = "grammarMotherTongue",
  /** Whether strict (picky) style rules are enabled during grammar checks. */
  GrammarPickyLevel = "grammarPickyLevel",
  /** Whether grammar issues are checked automatically while typing. */
  GrammarAutoCheck = "grammarAutoCheck",
  /** Category IDs the user has turned off for grammar checking. */
  GrammarDisabledCategories = "grammarDisabledCategories",
  /** Rule IDs the user has turned off for grammar checking. */
  GrammarDisabledRules = "grammarDisabledRules",
  /** Words never reported as misspellings, the user's personal dictionary. */
  GrammarDictionary = "grammarDictionary",
}

/** Styles of prefix that can be shown before headings. */
export enum HeadingPrefixStyle {
  /** Headings are displayed without a prefix. */
  None = "none",
  /** Numeric prefixes, for example: 1, 1.1, 1.1.1 */
  Numeric = "numeric",
  /** Alphanumeric prefixes, for example: 1, 1.a, 1.a.i */
  Alphanumeric = "alphanumeric",
  /** Outline-style prefixes, for example: I, I.A, I.A.1 */
  Outline = "outline",
}

/** Document-level preferences. */
export enum DocumentPreference {
  /** The style of prefix displayed before headings in the document. */
  HeadingPrefix = "headingPrefix",
}

/** Document preference values, keyed by preference. */
export type DocumentPreferences = {
  [DocumentPreference.HeadingPrefix]?: HeadingPrefixStyle;
};

/** Styles of unread notification badge. */
export enum NotificationBadgeType {
  /** Do not show a notification badge. */
  Disabled = "disabled",
  /** Show the unread notification count. */
  Count = "count",
  /** Show an unread indicator dot. */
  Indicator = "indicator",
}

/** User preference values, keyed by preference. */
export type UserPreferences = {
  [UserPreference.RememberLastPath]?: boolean;
  [UserPreference.UseCursorPointer]?: boolean;
  [UserPreference.CodeBlockLineNumers]?: boolean;
  [UserPreference.SeamlessEdit]?: boolean;
  [UserPreference.FullWidthDocuments]?: boolean;
  [UserPreference.SortCommentsByOrderInDocument]?: boolean;
  [UserPreference.CommentsInGutter]?: boolean;
  [UserPreference.EnableSmartText]?: boolean;
  [UserPreference.ShowDocumentStats]?: boolean;
  [UserPreference.NotificationBadge]?: NotificationBadgeType;
  [UserPreference.SidebarSectionOrder]?: SidebarSection[];
  [UserPreference.TranslationSourceLanguage]?: string;
  [UserPreference.TranslationTargetLanguage]?: string;
  [UserPreference.GrammarLanguage]?: string;
  [UserPreference.GrammarMotherTongue]?: string;
  [UserPreference.GrammarPickyLevel]?: boolean;
  [UserPreference.GrammarAutoCheck]?: boolean;
  [UserPreference.GrammarDisabledCategories]?: string[];
  [UserPreference.GrammarDisabledRules]?: string[];
  [UserPreference.GrammarDictionary]?: string[];
};
