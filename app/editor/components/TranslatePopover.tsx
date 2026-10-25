import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { s } from "@shared/styles";
import { useTranslation } from "react-i18next";
import BilingualStore from "~/stores/BilingualStore";
import { clampPanelPosition } from "~/utils/bilingual/overlay";

/** Width of the translation popover. */
const POPOVER_WIDTH = 380;

/** Approximate height used for viewport clamping before measuring. */
const POPOVER_ESTIMATED_HEIGHT = 220;

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
  const { text, isWord, blockIndex, anchor, onInsertText, onClose } = props;
  const [result, setResult] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [providers, setProviders] = React.useState<
    { id: string; label: string; configured: boolean }[]
  >([]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ left: 0, top: 0, above: false });

  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const [translated] = await BilingualStore.translate([text]);
        const providers = await BilingualStore.fetchProviders();

        if (cancelled) {
          return;
        }

        setResult(translated);
        setProviders(providers.filter((provider) => provider.configured));
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
  }, [text, t]);

  React.useEffect(() => {
    // Measure after first paint so the clamp uses the real size.
    const rect = containerRef.current?.getBoundingClientRect();
    const size = {
      width: rect?.width ?? POPOVER_WIDTH,
      height: rect?.height ?? POPOVER_ESTIMATED_HEIGHT,
    };
    setPosition(clampPanelPosition(anchor, size));
  }, [anchor, loading, result]);

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
              void event.currentTarget.value;
            }}
            aria-label={t("Translation service")}
            defaultValue=""
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
        {loading ? (
          <LoadingDots>{t("Translating…")}</LoadingDots>
        ) : error ? (
          <ErrorText>{error}</ErrorText>
        ) : (
          result
        )}
      </Result>
      <Actions>
        <ActionButton onClick={handleCopy} disabled={!result}>
          {t("Copy")}
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
