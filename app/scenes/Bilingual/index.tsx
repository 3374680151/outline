import { observer } from "mobx-react";
import { GlobeIcon, SearchIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Icon from "@shared/components/Icon";
import type { BilingualListRow } from "@shared/types/bilingual";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import LoadingIndicator from "~/components/LoadingIndicator";
import { BilingualCreateForm } from "~/components/BilingualCreateDialog";
import { useBilingualPairPaths } from "~/components/BilingualPairProvider";
import BilingualStore from "~/stores/BilingualStore";
import useStores from "~/hooks/useStores";
import history from "~/utils/history";
import { openBilingualRoute } from "~/utils/splitView";

/**
 * The bilingual documents index: every bilingual pair of the workspace as a
 * rich row with translation progress, collection, and last update, plus a
 * guided creation dialog and text filtering.
 */
const BilingualScene: React.FC = observer(function BilingualScene() {
  const { t } = useTranslation();
  const { collections } = useStores();
  const toPaths = useBilingualPairPaths();
  const { dialogs } = useStores();
  const [rows, setRows] = React.useState<BilingualListRow[] | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    void BilingualStore.listPairs().then((result) =>
      setRows(result as BilingualListRow[])
    );
  }, []);

  const openCreateDialog = React.useCallback(() => {
    dialogs.openModal({
      title: t("New bilingual document"),
      content: (
        <BilingualCreateForm
          onSubmit={async (title, collectionId) => {
            const pair = await BilingualStore.createPair({
              title,
              collectionId: collectionId ?? undefined,
            });
            const paths = await toPaths(
              pair.sourceDocumentId,
              pair.targetDocumentId
            );

            if (paths) {
              openBilingualRoute(
                history,
                paths.primaryPath,
                paths.secondaryPath
              );
            }
          }}
        />
      ),
    });
  }, [dialogs, t, toPaths]);

  const openPair = React.useCallback(
    async (row: BilingualListRow) => {
      const paths = await toPaths(row.sourceDocumentId, row.targetDocumentId);

      if (paths) {
        openBilingualRoute(history, paths.primaryPath, paths.secondaryPath);
      }
    },
    [toPaths]
  );

  const filtered = React.useMemo(() => {
    if (!rows) {
      return null;
    }

    const needle = query.trim().toLowerCase();

    if (!needle) {
      return rows;
    }

    return rows.filter(
      (row) =>
        row.sourceTitle.toLowerCase().includes(needle) ||
        row.targetTitle.toLowerCase().includes(needle)
    );
  }, [rows, query]);

  const progressOf = React.useCallback((row: BilingualListRow) => {
    const states = row.blockStates ?? [];
    const translated = states.filter(
      (state) => state && (state.autoText || state.status === "manual")
    ).length;
    return { translated, total: states.length };
  }, []);

  return (
    <Container>
      <Header>
        <div>
          <Heading>{t("Bilingual documents")}</Heading>
          <Subheading>
            {t(
              "Write in one language with a synchronized translation beside it. Open a pair to edit both documents side by side."
            )}
          </Subheading>
        </div>
        <Button icon={<GlobeIcon />} onClick={openCreateDialog}>
          {t("New bilingual document")}
        </Button>
      </Header>

      {rows && rows.length > 3 && (
        <SearchWrapper>
          <Input
            icon={<SearchIcon />}
            value={query}
            placeholder={`${t("Filter by title")}…`}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </SearchWrapper>
      )}

      {!filtered ? (
        <LoadingIndicator />
      ) : filtered.length === 0 ? (
        <EmptyState>
          <GlobeIcon size={40} />
          <EmptyTitle>
            {query
              ? t("No bilingual documents match your filter")
              : t("No bilingual documents yet")}
          </EmptyTitle>
          <EmptyText>
            {query
              ? t("Try a different title.")
              : t(
                  "Create your first bilingual document to write English with a synchronized Chinese translation."
                )}
          </EmptyText>
          {!query && (
            <Button onClick={openCreateDialog}>
              {t("New bilingual document")}
            </Button>
          )}
        </EmptyState>
      ) : (
        <List>
          {filtered.map((row) => {
            const collection = row.sourceCollectionId
              ? collections.get(row.sourceCollectionId)
              : undefined;
            const progress = progressOf(row);

            return (
              <Row key={row.id} onClick={() => void openPair(row)}>
                <DocIcon>
                  <Icon
                    value={row.sourceIcon ?? row.sourceTitle?.charAt(0) ?? "B"}
                    initial={row.sourceTitle?.charAt(0) ?? "B"}
                    color={row.sourceColor ?? undefined}
                  />
                </DocIcon>
                <Meta>
                  <RowTitle>
                    <TitleText>{row.sourceTitle || t("Untitled")}</TitleText>
                    {row.targetTitle && row.targetTitle !== row.sourceTitle && (
                      <MirrorTitle>{row.targetTitle}</MirrorTitle>
                    )}
                  </RowTitle>
                  <RowMeta>
                    <LangBadge>EN → CN</LangBadge>
                    {collection && (
                      <>
                        <Dot>·</Dot>
                        <span>{collection.name}</span>
                      </>
                    )}
                    <Dot>·</Dot>
                    <span>
                      {t("{{count}} blocks translated", {
                        count: progress.translated,
                      })}
                    </span>
                    <Dot>·</Dot>
                    <span>{new Date(row.updatedAt).toLocaleDateString()}</span>
                  </RowMeta>
                </Meta>
                <OpenHint>{t("Open")} →</OpenHint>
              </Row>
            );
          })}
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
  max-width: 860px;
`;

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
`;

const Heading = styled.h1`
  font-size: 22px;
  margin: 0 0 4px;
`;

const Subheading = styled.p`
  color: ${s("textSecondary")};
  margin: 0;
  max-width: 520px;
`;

const SearchWrapper = styled.div`
  max-width: 380px;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid ${s("divider")};
  border-radius: 8px;
  overflow: hidden;
`;

const Row = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  background: ${s("background")};
  border: none;
  border-bottom: 1px solid ${s("divider")};
  cursor: pointer;
  text-align: left;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: ${s("backgroundSecondary")};
  }
`;

const DocIcon = styled.div`
  flex: none;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Meta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
`;

const RowTitle = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: ${s("text")};
  overflow: hidden;
`;

const TitleText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: none;
  max-width: 60%;
`;

const MirrorTitle = styled.span`
  color: ${s("textTertiary")};
  font-weight: 400;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${s("textSecondary")};
  font-size: 12.5px;
`;

const LangBadge = styled.span`
  background: ${s("backgroundSecondary")};
  border-radius: 99px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  flex: none;
`;

const Dot = styled.span`
  color: ${s("textTertiary")};
`;

const OpenHint = styled.span`
  color: ${s("textSecondary")};
  font-size: 13px;
  opacity: 0;
  transition: opacity 100ms ease-in-out;
  flex: none;
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 60px 0;
  color: ${s("textSecondary")};
`;

const EmptyTitle = styled.h2`
  font-size: 16px;
  margin: 8px 0 0;
  color: ${s("text")};
`;

const EmptyText = styled.p`
  margin: 0 0 12px;
  max-width: 380px;
  text-align: center;
`;
