import { GlobeIcon } from "outline-icons";
import { useTranslation } from "react-i18next";
import * as Scenes from "~/routes/scenes";
import { translatePath } from "~/utils/routeHelpers";
import SidebarLink from "./SidebarLink";

export const TranslateLink = () => {
  const { t } = useTranslation();

  return (
    <SidebarLink
      to={translatePath()}
      onClickIntent={Scenes.Translate.preload}
      icon={<GlobeIcon />}
      label={t("Translate")}
    />
  );
};
