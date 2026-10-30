import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import { useTranslation } from "react-i18next";
import type { GrammarMatchDTO, WordLookupDTO } from "@shared/types/bilingual";
import BilingualStore from "~/stores/BilingualStore";
import history from "~/utils/history";
import { settingsPath } from "~/utils/routeHelpers";
import { grammarLevel } from "~/utils/bilingual/prefs";
import { GRAMMAR_TYPE_COLOR, matchType, type GrammarType } from "~/utils/bilingual/matchType";
import { clampPanelPosition } from "~/utils/bilingual/overlay";

/** Width of the translation popover. */
const POPOVER_WIDTH = 380;

/** Approximate height used for viewport clamping before measuring. */
const POPOVER_ESTIMATED_HEIGHT = 220;

/** localStorage key remembering the translation service chosen in the card. */
const PROVIDER_KEY = "bilingual-translation-provider";

/** How long to wait for a translation before offering a retry. */
const TRANSLATE_TIMEOUT_MS = 20000;

/**
 * Rejects when the given promise does not settle in time, so that a stalled
 * request can never leave the card showing "Translating…" indefinitely.
 *
 * @param promise The promise to await.
 * @param ms The timeout in milliseconds.
 * @returns The promise result.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Translation timed out")),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Props for the translation popover.
 */
export interface TranslatePopoverProps {
  /** The text to translate (a selection or a single word). */
  text: string;
  /** Whether the text is a single word (dictionary card layout). */
  isWord: boolean;
  /** The top-level block index the text came from. */
  blockIndex: number;
  /** The document the text belongs to. */
  documentId: string;
  /** The sentence containing a word lookup, for the grammar section. */
  sentence?: string;
  /** Viewport anchor rect to place the popover against. */
  anchor: { left: number; right: number; top: number; bottom: number };
  /** Called to write the translation into the mirror document block. */
  onInsertText?: (blockIndex: number, text: string) => void;
  /** Called when the popover should close. */
  onClose: () => void;
}

/**
 * Translation popover mirroring the FluentRead interaction: original text on
 * top, translation below, with copy, speak, service selection, and an insert
 * action when a bilingual mirror is available.
 */
export const TranslatePopover = observer(function TranslatePopover(
  props: TranslatePopoverProps
) {
  const { t } = useTranslation();
  const { text, isWord, blockIndex, anchor, sentence, onInsertText, onClose } = props;
  const [result, setResult] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [noProvider, setNoProvider] = React.useState(false);
  const [providers, setProviders] = React.useState<
    { id: string; label: string; configured: boolean }[]
  >([]);
  const [providerId, setProviderId] = React.useState<string>(() =>
    localStorage.getItem(PROVIDER_KEY) ?? ""
  );
  const [copied, setCopied] = React.useState(false);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [grammarMatches, setGrammarMatches] = React.useState<
    { message: string; shortMessage?: string; type: string }[]
  >([]);
  const [dictEntry, setDictEntry] = React.useState<WordLookupDTO | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ left: 0, top: 0, above: false });

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      setNoProvider(false);

      try {
        // Resolve the available services first: without a configured provider
        // the card must explain what to do instead of issuing a request that
        // is guaranteed to fail.
        const configured = (await BilingualStore.fetchProviders()).filter(
          (provider) => provider.configured
        );

        if (cancelled) {
          return;
        }

        setProviders(configured);

        if (configured.length === 0) {
          setNoProvider(true);
          setLoading(false);
          return;
        }

        let translated: string[];
        try {
          translated = await withTimeout(
            BilingualStore.translate([text], "zh", providerId || undefined),
            TRANSLATE_TIMEOUT_MS
          );
        } catch (err) {
          // A remembered service may have been removed or its credentials may
          // have been cleared; fall back to the automatic choice once.
          if (!providerId) {
            throw err;
          }
          setProviderId("");
          localStorage.removeItem(PROVIDER_KEY);
          translated = await withTimeout(
            BilingualStore.translate([text], "zh", undefined),
            TRANSLATE_TIMEOUT_MS
          );
        }

        if (cancelled) {
          return;
        }

        setResult(translated[0]);
      } catch (_err) {
        if (!cancelled) {
          setError(t("Translation failed"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [text, providerId, t, reloadToken]);

  React.useEffect(() => {
    // Word lookups also show the sentence's grammar issues inline.
    if (!isWord || !sentence) {
      return;
    }

    let cancelled = false;

    void BilingualStore.grammarCheck({
      text: sentence,
      language: "en-US",
      level: grammarLevel(),
      mode: "all",
    })
      .then((result) => {
        if (cancelled || !result.available || !Array.isArray(result.matches)) {
          return;
        }

        setGrammarMatches(
          (result.matches as {
            message: string;
            shortMessage?: string;
            rule: { id: string };
          }[]).map((match) => ({
            message: match.message,
            shortMessage: match.shortMessage,
            type: matchType(match as unknown as GrammarMatchDTO),
          }))
        );
      })
      .catch(() => {
        // Grammar sidecar unavailable – the card still shows the meaning.
      });

    return () => {
      cancelled = true;
    };
  }, [isWord, sentence]);

  React.useEffect(() => {
    // Word lookups also try the AI dictionary card (phonetics, senses,
    // examples) when an AI provider is configured server-side.
    if (!isWord || !sentence) {
      return;
    }

    let cancelled = false;

    void BilingualStore.lookupWord(text, sentence)
      .then((entry) => {
        if (!cancelled && entry) {
          setDictEntry(entry);
        }
      })
      .catch(() => {
        // Silent: the plain translation result remains the fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [isWord, sentence, text]);

  React.useEffect(() => {
    // Measure after first paint so the clamp uses the real size, and keep
    // re-measuring while the card grows (dictionary and grammar sections are
    // appended after the translation arrives).
    const measure = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      const size = {
        width: rect?.width ?? POPOVER_WIDTH,
        height: rect?.height ?? POPOVER_ESTIMATED_HEIGHT,
      };
      setPosition(clampPanelPosition(anchor, size));
    };

    measure();

    if (typeof ResizeObserver === "undefined" || !containerRef.current) {
      return;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [anchor, loading, result, noProvider, dictEntry, grammarMatches.length]);

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick, true);

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick, true);
    };
  }, [onClose]);

  const handleCopy = () => {
    if (result) {
      void navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const handleSpeak = () => {
    if (result && "speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(result);
      utterance.lang = "zh-CN";
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleInsert = () => {
    if (result && onInsertText) {
      onInsertText(blockIndex, result);
      onClose();
    }
  };

  return (
    <Container
      ref={containerRef}
      data-testid="translate-popover"
      $left={position.left}
      $top={position.top}
      role="dialog"
      aria-label={t("Translation")}
    >
      <Header>
        <LangLabel>
          {t("Source")} · {isWord ? t("Word") : t("Detected English")}
        </LangLabel>
        {providers.length > 0 && (
          <ServiceSelect
            onChange={(event) => {
              const value = event.currentTarget.value;
              setProviderId(value);
              localStorage.setItem(PROVIDER_KEY, value);
            }}
            aria-label={t("Translation service")}
            value={providerId}
          >
            <option value="">{t("Automatic")}</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </ServiceSelect>
        )}
        <CloseButton onClick={onClose} aria-label={t("Close")}>
          ✕
        </CloseButton>
      </Header>
      <Original>{text}</Original>
      <Result>
        {noProvider ? (
          <EmptyState>
            <EmptyTitle>{t("No translation service configured")}</EmptyTitle>
            <EmptyHint>
              {t(
                "Add an API key for a translation service to translate text while you write."
              )}
            </EmptyHint>
            <ConfigureButton
              onClick={() => {
                onClose();
                history.push(settingsPath("ai"));
              }}
            >
              {t("Open translation settings")}
            </ConfigureButton>
          </EmptyState>
        ) : loading ? (
          <LoadingDots>{t("Translating…")}</LoadingDots>
        ) : error ? (
          <ErrorRow>
            <ErrorText>{error}</ErrorText>
            <RetryButton
              onClick={() => setReloadToken((token) => token + 1)}
            >
              {t("Retry")}
            </RetryButton>
          </ErrorRow>
        ) : (
          result
        )}
      </Result>
      {isWord && dictEntry && (
        <DictSection>
          <DictWord>
            {dictEntry.word}
            {dictEntry.phonetic && <Phonetic>/{dictEntry.phonetic}/</Phonetic>}
          </DictWord>
          {dictEntry.senses.length > 0 && (
            <SenseList>
              {dictEntry.senses.map((sense, senseIndex) => (
                <Sense key={senseIndex}>
                  {sense.pos && <Pos>{sense.pos}</Pos>}
                  {sense.meaning}
                </Sense>
              ))}
            </SenseList>
          )}
          {dictEntry.examples.length > 0 && (
            <SenseList>
              {dictEntry.examples.map((example, exampleIndex) => (
                <Sense key={exampleIndex}>
                  {example.src}
                  <Muted> {example.dst}</Muted>
                </Sense>
              ))}
            </SenseList>
          )}
          <DictNote>{t("AI generated, for reference")}</DictNote>
        </DictSection>
      )}
      {isWord && grammarMatches.length > 0 && (
        <GrammarSection>
          <GrammarTitle>{t("Grammar in this sentence")}</GrammarTitle>
          {grammarMatches.map((issue, issueIndex) => (
            <GrammarIssue key={issueIndex}>
              <TypeBadgeInline $type={issue.type}>{issue.type}</TypeBadgeInline>
              {issue.shortMessage ?? issue.message}
            </GrammarIssue>
          ))}
        </GrammarSection>
      )}
      <Actions>
        <ActionButton onClick={handleCopy} disabled={!result}>
          {copied ? t("Copied") : t("Copy")}
        </ActionButton>
        <ActionButton onClick={handleSpeak} disabled={!result}>
          {t("Speak")}
        </ActionButton>
        {onInsertText && (
          <ActionButton $primary onClick={handleInsert} disabled={!result}>
            {t("Write into mirror")}
          </ActionButton>
        )}
      </Actions>
    </Container>
  );
});

const Container = styled.div<{ $left: number; $top: number }>`
  position: fixed;
  left: ${(props) => props.$left}px;
  top: ${(props) => props.$top}px;
  width: ${POPOVER_WIDTH}px;
  max-height: 50vh;
  overflow: auto;
  background: ${s("background")};
  color: ${s("text")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: 12px 14px;
  font-size: 14px;
  line-height: 1.6;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
`;

const LangLabel = styled.span`
  color: ${s("textSecondary")};
  font-size: 12px;
  flex: 1;
`;

const ServiceSelect = styled.select`
  background: ${s("backgroundSecondary")};
  color: ${s("text")};
  border: 1px solid ${s("divider")};
  border-radius: 4px;
  font-size: 12px;
  padding: 2px 4px;
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: ${s("textSecondary")};
  cursor: pointer;
  font-size: 12px;
  padding: 2px 4px;
`;

const Original = styled.div`
  background: ${s("backgroundSecondary")};
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  max-height: 96px;
  overflow: auto;
`;

const Result = styled.div`
  white-space: pre-wrap;
  margin-bottom: 10px;
`;

const LoadingDots = styled.span`
  color: ${s("textSecondary")};
`;

const ErrorText = styled.span`
  color: ${s("danger")};
`;

const DictSection = styled.div`
  border-top: 1px solid ${s("divider")};
  padding-top: 8px;
  margin-top: 4px;
`;

const DictWord = styled.div`
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
`;

const Phonetic = styled.span`
  font-weight: 400;
  color: ${s("textSecondary")};
  font-size: 12.5px;
`;

const SenseList = styled.ul`
  margin: 0 0 6px;
  padding-left: 16px;
`;

const Sense = styled.li`
  font-size: 13px;
  margin-bottom: 2px;
`;

const Pos = styled.span`
  color: ${s("accent")};
  font-style: italic;
  margin-right: 6px;
  font-size: 12px;
`;

const Muted = styled.span`
  color: ${s("textSecondary")};
`;

const DictNote = styled.div`
  font-size: 10.5px;
  color: ${s("textTertiary")};
`;

const GrammarSection = styled.div`
  border-top: 1px solid ${s("divider")};
  padding-top: 8px;
  margin-top: 4px;
`;

const GrammarTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${s("textSecondary")};
  margin-bottom: 6px;
`;

const GrammarIssue = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  padding: 3px 0;
`;

const TypeBadgeInline = styled.span<{ $type: string }>`
  font-size: 10px;
  font-weight: 600;
  border-radius: 99px;
  padding: 0 6px;
  flex: none;
  text-transform: capitalize;
  background: ${(props) => GRAMMAR_TYPE_COLOR[(props.$type as GrammarType) ?? "other"] ?? "#64748b"}1f;
  color: ${(props) => GRAMMAR_TYPE_COLOR[(props.$type as GrammarType) ?? "other"] ?? "#64748b"};
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  background: ${(props) => (props.$primary ? s("accent") : "transparent")};
  color: ${(props) => (props.$primary ? "#fff" : s("textSecondary"))};
  border: 1px solid ${(props) => (props.$primary ? "transparent" : s("divider"))};
  border-radius: 4px;
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

export default TranslatePopover;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: ${s("backgroundSecondary")};
  border-radius: 6px;
`;

const EmptyTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
`;

const EmptyHint = styled.div`
  font-size: 12px;
  color: ${s("textSecondary")};
  line-height: 1.5;
`;

const ConfigureButton = styled.button`
  align-self: flex-start;
  background: ${s("accent")};
  color: ${s("accentText")};
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  padding: 4px 10px;
`;

const ErrorRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const RetryButton = styled.button`
  background: ${s("backgroundSecondary")};
  border: 1px solid ${s("divider")};
  border-radius: 4px;
  color: ${s("text")};
  cursor: pointer;
  font-size: 12px;
  padding: 2px 10px;
  flex: none;

  &:hover {
    background: ${s("backgroundTertiary")};
  }
`;
