import { action, comparer, makeObservable, observable, reaction } from "mobx";
import type { Node as ProsemirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import scrollIntoView from "scroll-into-view-if-needed";
import { GRAMMAR_AUTO_DETECT } from "@shared/constants";
import { UserPreference } from "@shared/types";
import { errToString } from "@shared/utils/error";
import Extension from "@shared/editor/lib/Extension";
import { mapDecorations } from "@shared/editor/lib/multiplayer";
import stores from "~/stores";
import { client } from "~/utils/ApiClient";
import {
  applyGrammarFix,
  collectGrammarBlocks,
  filterGrammarMatches,
  grammarIssueKind,
  isCheckableText,
  locateGrammarRange,
  locateInBlock,
  type GrammarBlock,
  type GrammarMatch,
} from "~/utils/documentGrammar";
import GrammarCard from "../components/GrammarCard";

const pluginKey = new PluginKey<DecorationSet>("grammar-check");

/** Delay after the last document change before changed blocks are checked. */
const CHECK_DEBOUNCE_MS = 1200;

/** One grammar, spelling or style issue located in the document. */
export interface GrammarIssue {
  /** Identifies the issue within its checked block */
  key: string;
  /** Document position of the flagged text start */
  from: number;
  /** Document position of the flagged text end */
  to: number;
  /** The flagged text */
  text: string;
  /** The reported match */
  match: GrammarMatch;
  /** The checked block text the match offsets refer to */
  unitText: string;
}

/** Status of a grammar checking pass. */
export type GrammarStatus = "idle" | "loading" | "error";

interface GrammarCheckResponse {
  data: {
    matches: GrammarMatch[];
    detectedLanguage?: string;
    incompleteResults?: boolean;
  };
}

/**
 * Underlines grammar, spelling and style issues in the document text and
 * opens the official-style correction card when an underline is clicked.
 * Checking runs while editing, driven by the user's grammar preferences,
 * independent of the assistant pane.
 */
export default class GrammarCheckExtension extends Extension {
  public get name() {
    return "grammar-check";
  }

  constructor() {
    super();
    makeObservable(this);
  }

  /** Issues of the current document, in document order. */
  @observable
  public issues: GrammarIssue[] = [];

  /** Status of the current checking pass. */
  @observable
  public status: GrammarStatus = "idle";

  /** Error of the last failed checking pass. */
  @observable
  public error: string | undefined = undefined;

  /** The issue whose correction card is shown. */
  @observable
  public activeIssue: GrammarIssue | null = null;

  /** Detected language of each checked block, keyed by block text. */
  @observable
  public detectedLanguages = observable.map<string, string>();

  /** Whether the last check returned only partial results. */
  @observable
  public incompleteResults = false;

  /** Checked blocks keyed by text, guards against duplicate requests. */
  private results = new Map<string, GrammarMatch[]>();

  /** Sequence counter so superseded checking passes stop early. */
  private checkSeq = 0;

  /** Debounce timer of the scheduled check. */
  private checkTimer: ReturnType<typeof setTimeout> | undefined;

  public get plugins() {
    return [
      new Plugin({
        key: pluginKey,
        view: () => {
          // Preferences that change what the service checks invalidate all
          // cached results; dictionary and disabled rules are filtered when
          // issues are rebuilt instead.
          const disposer = reaction(
            () => this.affectingPreferences(),
            () => {
              this.results.clear();
              this.detectedLanguages.clear();
              this.scheduleCheck();
            },
            { equals: comparer.structural }
          );

          // Pick up blocks of a document that was already populated when the
          // view mounted, as no docChanged transaction will follow.
          this.scheduleCheck();

          return {
            destroy: () => {
              disposer();
              if (this.checkTimer) {
                clearTimeout(this.checkTimer);
              }
            },
          };
        },
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, decorationSet, _oldState, newState) => {
            if (tr.getMeta(pluginKey)) {
              return this.createDecorationSet(newState.doc);
            }

            if (tr.docChanged) {
              this.scheduleCheck();
              // mapDecorations handles remote (Yjs) transactions, whose
              // mapping cannot be applied naively.
              return mapDecorations(decorationSet, tr, newState);
            }

            return decorationSet;
          },
        },
        props: {
          decorations: (state) => pluginKey.getState(state),
          // mouseup rather than click: the Mermaid extension's click handler
          // claims every click, so later plugins never see click events.
          handleDOMEvents: {
            mouseup: (_view, event) => this.handleClick(event),
          },
        },
      }),
    ];
  }

  public widget = () => <GrammarCard extension={this} />;

  /** Re-runs the grammar check over unchecked blocks now. */
  public checkNow() {
    void this.runCheck();
  }

  /**
   * Opens the correction card of an issue and scrolls it into view.
   *
   * @param issue The issue to reveal.
   */
  @action
  public focusIssue(issue: GrammarIssue) {
    this.openIssue(issue);
    const view = this.editor?.view;
    const located = view
      ? locateGrammarRange(view.state.doc, {
          unitText: issue.unitText,
          offset: issue.match.offset,
          length: issue.match.length,
        })
      : undefined;

    if (view && located) {
      const domAtPos = view.domAtPos(located.from);
      const element =
        domAtPos.node instanceof Element
          ? domAtPos.node
          : domAtPos.node.parentElement;

      if (element) {
        scrollIntoView(element, {
          scrollMode: "if-needed",
          block: "center",
        });
      }
    }
  }

  /** Closes the correction card. */
  @action
  public closeCard() {
    this.activeIssue = null;
  }

  /**
   * Applies a replacement suggestion to the document and re-checks the
   * changed block.
   *
   * @param issue The issue to fix.
   * @param replacement The replacement text.
   * @returns True when the document was modified.
   */
  @action
  public applySuggestion(issue: GrammarIssue, replacement: string): boolean {
    const editor = this.editor;

    if (!editor) {
      return false;
    }

    const applied = applyGrammarFix(editor, {
      unitText: issue.unitText,
      offset: issue.match.offset,
      length: issue.match.length,
      replacement,
    });

    if (applied) {
      this.activeIssue = null;
      this.results.delete(issue.unitText);
      void this.runCheck();
    }

    return applied;
  }

  /**
   * Turns the rule the issue was reported by off for the user and removes its
   * issues immediately.
   *
   * @param issue The issue whose rule to ignore.
   */
  public async ignoreRule(issue: GrammarIssue) {
    const ruleId = issue.match.ruleId;
    const user = stores.auth?.user;

    if (!ruleId || !user) {
      return;
    }

    const current =
      user.preferences?.[UserPreference.GrammarDisabledRules] ?? [];

    if (!current.includes(ruleId)) {
      user.setPreference(UserPreference.GrammarDisabledRules, [
        ...current,
        ruleId,
      ]);
      await user.save();
    }

    this.activeIssue = null;
    this.rebuildIssues();
  }

  /**
   * Adds the flagged word to the user's personal dictionary so it is never
   * reported as a misspelling again.
   *
   * @param issue The misspelled issue.
   */
  public async addToDictionary(issue: GrammarIssue) {
    const word = issue.text;
    const user = stores.auth?.user;

    if (!word || !user) {
      return;
    }

    const current = user.preferences?.[UserPreference.GrammarDictionary] ?? [];

    if (!current.includes(word)) {
      user.setPreference(UserPreference.GrammarDictionary, [...current, word]);
      await user.save();
    }

    this.activeIssue = null;
    this.rebuildIssues();
  }

  /**
   * Measures the on-screen rect of an issue's flagged text, for anchoring the
   * correction card.
   *
   * @param issue The issue to measure.
   * @returns The rect, or undefined when it cannot be measured.
   */
  public measureIssueRect(issue: GrammarIssue): DOMRect | undefined {
    const view = this.editor?.view;

    if (!view) {
      return undefined;
    }

    try {
      const fromPos = view.coordsAtPos(issue.from);
      const toPos = view.coordsAtPos(issue.to, -1);
      const top = Math.min(fromPos.top, toPos.top);
      const bottom = Math.max(fromPos.bottom, toPos.bottom);
      const left = Math.min(fromPos.left, toPos.left);
      const right = Math.max(fromPos.right, toPos.right);
      return new DOMRect(left, top, right - left, bottom - top);
    } catch {
      return undefined;
    }
  }

  /**
   * Returns the language the issue's block was detected as, when known.
   *
   * @param issue The issue to look up.
   * @returns The detected BCP-47 tag, or undefined.
   */
  public issueLanguage(issue: GrammarIssue): string | undefined {
    return this.detectedLanguages.get(issue.unitText);
  }

  /**
   * Returns the preferences that change what the service checks, as a
   * structurally comparable value.
   *
   * @returns The affecting preference values.
   */
  private affectingPreferences() {
    const user = stores.auth?.user;
    return [
      user?.getPreference(UserPreference.GrammarLanguage),
      user?.preferences?.[UserPreference.GrammarMotherTongue],
      user?.getPreference(UserPreference.GrammarPickyLevel),
      user?.preferences?.[UserPreference.GrammarDisabledCategories],
    ];
  }

  /**
   * Schedules a debounced check of the document, unless automatic checking
   * is turned off in the user's preferences.
   */
  private scheduleCheck() {
    const user = stores.auth?.user;
    const autoCheck = user
      ? user.getPreference(UserPreference.GrammarAutoCheck)
      : true;

    if (!autoCheck) {
      return;
    }

    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }
    this.checkTimer = setTimeout(() => {
      this.checkTimer = undefined;
      void this.runCheck();
    }, CHECK_DEBOUNCE_MS);
  }

  /** Checks every unchecked block of the document and rebuilds the issues. */
  @action
  private async runCheck() {
    const view = this.editor?.view;
    const user = stores.auth?.user;

    if (!view || !user) {
      return;
    }

    const seq = ++this.checkSeq;
    const blocks = collectGrammarBlocks(view.state.doc).filter((block) =>
      isCheckableText(block.text)
    );
    const pending = blocks.filter((block) => !this.results.has(block.text));

    this.rebuildIssues(blocks);

    if (pending.length === 0) {
      this.status = "idle";
      return;
    }

    this.status = "loading";
    this.error = undefined;

    const language = user.getPreference(UserPreference.GrammarLanguage);
    const motherTongue = user.preferences?.[UserPreference.GrammarMotherTongue];
    const picky = user.getPreference(UserPreference.GrammarPickyLevel);
    const disabledCategories =
      user.preferences?.[UserPreference.GrammarDisabledCategories] ?? [];
    const disabledRules =
      user.preferences?.[UserPreference.GrammarDisabledRules] ?? [];

    const body = {
      text: "",
      language: language || GRAMMAR_AUTO_DETECT,
      ...(motherTongue ? { motherTongue } : {}),
      ...(picky ? { level: "picky" as const } : {}),
      ...(disabledCategories.length ? { disabledCategories } : {}),
      ...(disabledRules.length ? { disabledRules } : {}),
    };

    let incomplete = false;

    for (const block of pending) {
      if (seq !== this.checkSeq) {
        return;
      }

      try {
        const res = await client.post<GrammarCheckResponse>("/grammar.check", {
          ...body,
          text: block.text,
        });

        if (seq !== this.checkSeq) {
          return;
        }

        this.results.set(block.text, res.data.matches);
        incomplete = incomplete || !!res.data.incompleteResults;

        if (res.data.detectedLanguage) {
          this.detectedLanguages.set(block.text, res.data.detectedLanguage);
        }
      } catch (err) {
        if (seq !== this.checkSeq) {
          return;
        }
        this.status = "error";
        this.error = errToString(err);
        return;
      }
    }

    if (seq !== this.checkSeq) {
      return;
    }

    this.status = "idle";
    this.incompleteResults = incomplete;
    this.rebuildIssues();
  }

  /**
   * Rebuilds the located issues from the cached check results. Dictionary
   * words and disabled rules are filtered with the current preferences.
   *
   * @param blocks The blocks of the current document, when already collected.
   */
  @action
  private rebuildIssues(blocks?: GrammarBlock[]) {
    const doc = this.editor?.view.state.doc;

    if (!doc) {
      return;
    }

    const user = stores.auth?.user;
    const dictionary = user?.preferences?.[UserPreference.GrammarDictionary];
    const disabledRules =
      user?.preferences?.[UserPreference.GrammarDisabledRules];
    const current = blocks ?? collectGrammarBlocks(doc);
    const issues: GrammarIssue[] = [];

    for (const block of current) {
      const matches = this.results.get(block.text);

      if (!matches) {
        continue;
      }

      for (const match of filterGrammarMatches(block.text, matches, {
        dictionary,
        disabledRules,
      })) {
        const segment = locateInBlock(block, match.offset, match.length);

        if (!segment) {
          continue;
        }

        issues.push({
          key: `${block.text}:${match.offset}:${match.length}:${
            match.ruleId ?? ""
          }`,
          from: segment.from,
          to: segment.to,
          text: block.text.slice(match.offset, match.offset + match.length),
          match,
          unitText: block.text,
        });
      }
    }

    this.issues = issues;
    this.refreshDecorations();
  }

  /** Rebuilds the underline decorations from the located issues. */
  private refreshDecorations() {
    const view = this.editor?.view;

    if (view) {
      view.dispatch(view.state.tr.setMeta(pluginKey, { refresh: true }));
    }
  }

  /**
   * Creates the underline decorations of the current issues.
   *
   * @param doc The document to decorate.
   * @returns The decoration set.
   */
  private createDecorationSet(doc: ProsemirrorNode): DecorationSet {
    const decorations = this.issues.map((issue) =>
      Decoration.inline(issue.from, issue.to, {
        class: `grammar-issue grammar-${grammarIssueKind(issue.match)}`,
        "data-grammar-key": issue.key,
      })
    );

    return decorations.length
      ? DecorationSet.create(doc, decorations)
      : DecorationSet.empty;
  }

  /**
   * Opens the correction card of the clicked issue, selecting the flagged
   * text like the official client does.
   *
   * @param issue The issue to open.
   */
  @action
  private openIssue(issue: GrammarIssue) {
    this.activeIssue = issue;
    const view = this.editor?.view;

    if (view) {
      const located = locateGrammarRange(view.state.doc, {
        unitText: issue.unitText,
        offset: issue.match.offset,
        length: issue.match.length,
      });

      if (located) {
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, located.from, located.to)
          )
        );
      }
    }
  }

  /**
   * Handles a click in the editor, opening the correction card when an
   * underlined issue was hit.
   *
   * @param event The click event.
   * @returns Whether the click was consumed.
   */
  private handleClick(event: Event): boolean {
    if (!(event.target instanceof HTMLElement)) {
      return false;
    }

    const target = event.target.closest<HTMLElement>(".grammar-issue");

    if (!target) {
      return false;
    }

    const key = target.getAttribute("data-grammar-key");
    const issue = key
      ? this.issues.find((item) => item.key === key)
      : undefined;

    if (issue) {
      this.openIssue(issue);
      return true;
    }

    return false;
  }
}
