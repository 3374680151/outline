import { observer } from "mobx-react";
import { CheckmarkIcon, GlobeIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Action } from "~/components/Actions";
import Button from "~/components/Button";
import Tooltip from "~/components/Tooltip";
import BilingualStore from "~/stores/BilingualStore";
import {
  setTranslationTrigger,
  translationTrigger,
} from "~/utils/bilingual/prefs";

/**
 * A compact header toggle button for the user-level editing assist:
 * the selection translation trigger. The state persists as a server-side
 * user preference, so it syncs across devices; the editor extension reads
 * the same preference live and applies changes without remounting.
 *
 * @returns The editing assist toggle button for the document header.
 */
export const EditingAssistToggles = observer(
  function EditingAssistToggles() {
    const { t } = useTranslation();
    const trigger = translationTrigger();
    const translateOn = trigger !== "off";

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
          <Tooltip content={t("Grammar check")} side="bottom">
            <AssistButton
              aria-label={t("Grammar check")}
              onClick={() => BilingualStore.requestProofread()}
              icon={<CheckmarkIcon />}
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
