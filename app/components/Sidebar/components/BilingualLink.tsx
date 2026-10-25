import { observer } from "mobx-react";
import { GlobeIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import * as Scenes from "~/routes/scenes";
import { bilingualHomePath } from "~/utils/routeHelpers";
import SidebarLink from "./SidebarLink";

/**
 * Sidebar entry into the bilingual documents index.
 */
export const BilingualLink = observer(function BilingualLink() {
  const { t } = useTranslation();

  return (
    <SidebarLink
      to={bilingualHomePath()}
      onClickIntent={Scenes.Bilingual.preload}
      icon={<GlobeIcon />}
      label={t("Bilingual writing")}
    />
  );
});
