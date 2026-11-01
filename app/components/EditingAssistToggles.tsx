import { observer } from "mobx-react";
import { CaseSensitiveIcon, GlobeIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Action } from "~/components/Actions";
import Button from "~/components/Button";
import Tooltip from "~/components/Tooltip";
import {
  grammarCheckingEnabled,
  setGrammarCheckingEnabled,
  setTranslationTrigger,
  translationTrigger,
} from "~/utils/bilingual/prefs";

/**
 * A pair of compact header toggle buttons for the user-level editing
 * assists: grammar checking underlines and the selection translation
 * trigger. Both states persist as server-side user preferences, so they
 * sync across devices; the editor extensions read the same preferences
 * live and apply changes without remounting.
 *
 * @returns The editing assist toggle buttons for the document header.
 */
export const EditingAssistToggles = observer(
  function EditingAssistToggles() {
    const { t } = useTranslation();
    const grammarOn = grammarCheckingEnabled();
    const trigger = translationTrigger();
    const translateOn = trigger !== "off";

    const handleGrammarToggle = () => {
      setGrammarCheckingEnabled(!grammarOn);
    };

    const handleTranslateToggle = () => {
      // The button is a quick on/off switch: an active trigger returns to
      // the default dot mode, and the hover mode stays selectable through
      // the bilingual toolbar menu and the settings page.
      setTranslationTrigger(translateOn ? "off" : "dot");
    };

    const triggerLabel =
      trigger === "dot"
        ? t("Dot next to selection")
        : trigger === "hover"
          ? t("Hover words")
          : t("Off");

    return (
      <>
        <Action>
          <Tooltip
            content={`${t("Grammar checking")}: ${
              grammarOn ? t("On") : t("Off")
            }`}
            side="bottom"
          >
            <AssistButton
              $on={grammarOn}
              aria-pressed={grammarOn}
              aria-label={t("Grammar checking")}
              onClick={handleGrammarToggle}
              icon={<CaseSensitiveIcon />}
              borderOnHover
              neutral
            />
          </Tooltip>
        </Action>
        <Action>
          <Tooltip
            content={`${t("Word translation")}: ${triggerLabel}`}
            side="bottom"
          >
            <AssistButton
              $on={translateOn}
              aria-pressed={translateOn}
              aria-label={t("Word translation")}
              onClick={handleTranslateToggle}
              icon={<GlobeIcon />}
              borderOnHover
              neutral
            />
          </Tooltip>
        </Action>
      </>
    );
  }
);

/**
 * A header toggle button with an accent highlight while its assist is
 * enabled, matching the toolbar chip active tint.
 */
const AssistButton = styled(Button)<{ $on?: boolean }>`
  && {
    ${(props) =>
      props.$on
        ? `
          background: ${props.theme.accent}1f;
          color: ${props.theme.accent};
        `
        : ""}
  }
`;
