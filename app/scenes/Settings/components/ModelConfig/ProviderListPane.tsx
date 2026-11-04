import { observer } from "mobx-react";
import { SearchIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import Input from "~/components/Input";
import Switch from "~/components/Switch";
import {
  PROVIDER_GROUPS,
  type ModelProviderInfo,
  kindOfRow,
} from "./types";

type GroupKind = (typeof PROVIDER_GROUPS)[number]["kind"];

/**
 * The left pane of the model configuration page: a search box, the provider
 * list grouped by vendor catalog kind (collapsible, with an enable switch per
 * row), and the add-provider entry. Selecting a row only changes the right
 * pane; the switch only toggles the provider.
 *
 * @param props The pane props.
 * @param props.rows All providers, including disabled ones.
 * @param props.selectedId The currently selected row id, if any.
 * @param props.onSelect Called when a row is clicked.
 * @param props.onToggle Called when a row's switch changes.
 * @param props.onAdd Called when the add button is clicked.
 */
export const ProviderListPane = observer(function ProviderListPane({
  rows,
  selectedId,
  onSelect,
  onToggle,
  onAdd,
}: {
  rows: ModelProviderInfo[];
  selectedId: string | null;
  onSelect: (row: ModelProviderInfo) => void;
  onToggle: (row: ModelProviderInfo, enabled: boolean) => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = React.useState("");
  const [folded, setFolded] = React.useState<Partial<Record<GroupKind, boolean>>>(
    {}
  );

  const groups = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return PROVIDER_GROUPS.map((group) => ({
      ...group,
      rows: rows.filter(
        (row) =>
          kindOfRow(row) === group.kind &&
          (!q || row.name.toLowerCase().includes(q))
      ),
    })).filter((group) => group.rows.length > 0);
  }, [rows, query]);

  const toggleFold = (kind: GroupKind) => {
    setFolded((prev) => ({
      ...prev,
      [kind]: !prev[kind],
    }));
  };

  return (
    <Pane>
      <SearchWrapper>
        <Input
          value={query}
          placeholder={t("Search providers…")}
          icon={<SearchIcon />}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </SearchWrapper>

      <ListBody>
        {groups.map((group) => (
          <Group key={group.kind}>
            <GroupHead
              type="button"
              aria-expanded={!folded[group.kind]}
              onClick={() => toggleFold(group.kind)}
            >
              <Chevron $folded={!!folded[group.kind]} viewBox="0 0 24 24" aria-hidden>
                <path
                  d="m6 9 6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Chevron>
              <GroupTitle>{t(group.labelKey)}</GroupTitle>
              <GroupCount>{group.rows.length}</GroupCount>
            </GroupHead>

            {!folded[group.kind] &&
              group.rows.map((row) => (
                <Row
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  $selected={row.id === selectedId}
                  onClick={() => onSelect(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(row);
                    }
                  }}
                >
                  <Logo aria-hidden>{row.name.slice(0, 1).toUpperCase()}</Logo>
                  <RowName>{row.name}</RowName>
                  {!row.hasApiKey && kindOfRow(row) !== "local" && (
                    <WarnDot title={t("API key missing")} />
                  )}
                  <SwitchWrapper
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Switch
                      id={`provider-toggle-${row.id}`}
                      name={`provider-toggle-${row.id}`}
                      checked={row.enabled}
                      onChange={(checked: boolean) => onToggle(row, checked)}
                      aria-label={t("Enabled")}
                    />
                  </SwitchWrapper>
                </Row>
              ))}
          </Group>
        ))}

        {groups.length === 0 && query.trim() && (
          <Empty>
            {t("No matching providers")}
            <ClearButton type="button" onClick={() => setQuery("")}>
              {t("Clear search")}
            </ClearButton>
          </Empty>
        )}
        {groups.length === 0 && !query.trim() && (
          <Empty>{t("No providers yet — add the first one below.")}</Empty>
        )}
      </ListBody>

      <AddButton type="button" onClick={onAdd}>
        {t("Add provider")}
      </AddButton>
    </Pane>
  );
});

const Pane = styled.aside`
  display: flex;
  flex: none;
  flex-direction: column;
  width: 264px;
  padding: 12px;
  background: ${s("background")};
  border: 1px solid ${s("divider")};
  border-radius: 8px;
`;

const SearchWrapper = styled.div`
  margin-top: 4px;
`;

const ListBody = styled.div`
  flex: 1;
  min-height: 120px;
  max-height: 520px;
  margin-top: 8px;
  overflow-y: auto;
`;

const Group = styled.section`
  & + & {
    margin-top: 4px;
  }
`;

const GroupHead = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: none;
  background: none;
  cursor: pointer;
  color: ${s("textSecondary")};
`;

const GroupTitle = styled.span`
  flex: 1;
  text-align: left;
  font-size: 13px;
  font-weight: 600;
`;

const GroupCount = styled.span`
  font-size: 12px;
  color: ${s("textTertiary")};
`;

const Chevron = styled.svg<{ $folded?: boolean }>`
  flex: none;
  width: 12px;
  height: 12px;
  color: ${s("textTertiary")};
  transition: transform 150ms ease-in-out;
  ${(props) => (props.$folded ? "transform: rotate(-90deg);" : "")}
`;

const Row = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 150ms ease-in-out;

  &:hover {
    background: ${s("backgroundSecondary")};
  }

  ${(props) =>
    props.$selected
      ? `
        background: ${s("backgroundSecondary")};
        box-shadow: inset 2px 0 0 ${s("accent")};
      `
      : ""}
`;

const Logo = styled.span`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: ${s("backgroundTertiary")};
  color: ${s("textSecondary")};
  font-size: 11px;
  font-weight: 600;
`;

const RowName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: ${s("text")};
`;

const WarnDot = styled.span`
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${s("noticeWarningText")};
`;

const SwitchWrapper = styled.span`
  display: inline-flex;
  flex: none;
  align-items: center;
`;

const Empty = styled.div`
  padding: 16px 8px;
  font-size: 13px;
  color: ${s("textTertiary")};
  text-align: center;
`;

const ClearButton = styled.button`
  display: block;
  margin: 4px auto 0;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: ${s("accent")};
`;

const AddButton = styled.button`
  width: 100%;
  height: 36px;
  margin-top: 12px;
  border: none;
  border-radius: 6px;
  background: ${s("accent")};
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 150ms ease-in-out;

  &:hover {
    opacity: 0.9;
  }
`;
