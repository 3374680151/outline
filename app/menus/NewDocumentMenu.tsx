import { observer } from "mobx-react";
import { ExpandedIcon, GlobeIcon, PlusIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styled from "styled-components";
import { s } from "@shared/styles";
import Button from "~/components/Button";
import { BilingualCreateForm } from "~/components/BilingualCreateDialog";
import { DropdownMenu } from "~/components/Menu/DropdownMenu";
import Tooltip from "~/components/Tooltip";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import usePolicy from "~/hooks/usePolicy";
import useStores from "~/hooks/useStores";
import { createAction, createActionWithChildren } from "~/actions";
import { ActiveDocumentSection } from "~/actions/sections";
import { preloadEditor } from "~/routes/scenes";
import { newDocumentPath } from "~/utils/routeHelpers";
import BilingualStore from "~/stores/BilingualStore";
import { openBilingualRoute } from "~/utils/splitView";
import history from "~/utils/history";

function NewDocumentMenu() {
  const { t } = useTranslation();
  const team = useCurrentTeam();
  const can = usePolicy(team);
  const { dialogs } = useStores();

  const openBilingualDialog = React.useCallback(() => {
    dialogs.openModal({
      title: t("New bilingual document"),
      content: (
        <BilingualCreateForm
          onSubmit={async (title, collectionId) => {
            const pair = await BilingualStore.createPair({
              title,
              collectionId: collectionId ?? undefined,
            });
            openBilingualRoute(
              history,
              `/doc/${pair.sourceDocumentId}`,
              `/doc/${pair.targetDocumentId}`
            );
          }}
        />
      ),
    });
  }, [dialogs, t]);

  const typeActions = React.useMemo(
    () => [
      createAction({
        name: t("Bilingual document"),
        section: ActiveDocumentSection,
        icon: <GlobeIcon />,
        keywords: "bilingual translate 中文 翻译 双语",
        perform: openBilingualDialog,
      }),
    ],
    [t, openBilingualDialog]
  );

  if (!can.createDocument) {
    return null;
  }

  return (
    <Tooltip content={t("New document")} shortcut="n" side="bottom">
      <SplitButton>
        <Button
          as={Link}
          to={newDocumentPath()}
          icon={<PlusIcon />}
          onPointerEnter={preloadEditor}
          onFocus={preloadEditor}
        >
          {t("New doc")}
        </Button>
        <DropdownMenu
          action={createActionWithChildren({
            name: t("Document type"),
            section: ActiveDocumentSection,
            children: typeActions,
          })}
          ariaLabel={t("Document type")}
          align="start"
        >
          <TypeDisclosure aria-label={t("Document type")}>
            <ExpandedIcon size={14} />
          </TypeDisclosure>
        </DropdownMenu>
      </SplitButton>
    </Tooltip>
  );
}

const SplitButton = styled.div`
  display: inline-flex;
  align-items: stretch;

  ${'button'}:first-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
`;

const TypeDisclosure = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  border: 1px solid ${s("inputBorder")};
  border-left: none;
  border-radius: 0 4px 4px 0;
  background: ${s("background")};
  color: ${s("textSecondary")};
  cursor: pointer;

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

export default observer(NewDocumentMenu);
