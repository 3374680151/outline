import { observer } from "mobx-react";
import { GlobeIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import { TeamPreference } from "@shared/types";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import * as Scenes from "~/routes/scenes";
import { bilingualHomePath } from "~/utils/routeHelpers";
import SidebarLink from "./SidebarLink";

/**
 * Sidebar entry into the bilingual documents index. Hidden when the
 * workspace has disabled the bilingual editor.
 */
export const BilingualLink = observer(function BilingualLink() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const enabled = team?.getPreference(TeamPreference.BilingualEditor) ?? true;

  if (!enabled) {
    return null;
  }

  return (
    <SidebarLink
      to={bilingualHomePath()}
      onClickIntent={Scenes.Bilingual.preload}
      icon={<GlobeIcon />}
      label={t("Bilingual writing")}
    />
  );
});
