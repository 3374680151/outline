import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import type { BilingualPairDTO } from "@shared/types/bilingual";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import LoadingIndicator from "~/components/LoadingIndicator";
import BilingualStore from "~/stores/BilingualStore";
import history from "~/utils/history";
import { bilingualEditorPathById } from "~/utils/routeHelpers";

type PairRow = BilingualPairDTO & {
  sourceTitle: string;
  targetTitle: string;
  sourceCollectionId: string | null;
};

/**
 * The bilingual documents index: every bilingual pair of the workspace with
 * a shortcut into the split editor, plus creation of a new pair.
 */
const BilingualScene: React.FC = observer(function BilingualScene() {
  const { t } = useTranslation();
  const [pairs, setPairs] = React.useState<PairRow[] | null>(null);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    void BilingualStore.listPairs().then((result) => setPairs(result));
  }, []);

  const handleCreate = async () => {
    setCreating(true);

    try {
      const pair = await BilingualStore.createPair({
        title: t("Untitled"),
      });
      history.push(bilingualEditorPathById(pair.sourceDocumentId));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Container>
      <Header>
        <Heading>{t("Bilingual documents")}</Heading>
        <Button onClick={handleCreate} disabled={creating}>
          {creating ? t("Creating…") : t("New bilingual document")}
        </Button>
      </Header>
      {!pairs ? (
        <LoadingIndicator />
      ) : pairs.length === 0 ? (
        <Empty>{t("No bilingual documents yet")}</Empty>
      ) : (
        <List>
          {pairs.map((row) => (
            <Row key={row.id}>
              <TitleLink
                onClick={() =>
                  history.push(bilingualEditorPathById(row.sourceDocumentId))
                }
              >
                {row.sourceTitle || t("Untitled")}
              </TitleLink>
              <Meta>{`${t("EN")} → ${t("CN")}`}</Meta>
            </Row>
          ))}
        </List>
      )}
    </Container>
  );
});

export default BilingualScene;

const Container = styled(Flex)`
  flex-direction: column;
  padding: 24px 32px;
  gap: 16px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Heading = styled.h1`
  font-size: 22px;
  margin: 0;
`;

const Empty = styled.p`
  color: ${s("textSecondary")};
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid ${s("divider")};
`;

const TitleLink = styled.button`
  background: none;
  border: none;
  color: ${s("text")};
  cursor: pointer;
  font-size: 15px;
  text-align: left;

  &:hover {
    color: ${s("accent")};
  }
`;

const Meta = styled.span`
  color: ${s("textSecondary")};
  font-size: 13px;
`;
