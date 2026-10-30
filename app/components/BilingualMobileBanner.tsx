import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { s } from "@shared/styles";
import { useBilingualPair } from "~/components/BilingualPairProvider";
import useMobile from "~/hooks/useMobile";
import useStores from "~/hooks/useStores";
import type Document from "~/models/Document";
import history from "~/utils/history";
import { documentPath } from "~/utils/routeHelpers";
import { withoutSplitViewNavigation } from "~/utils/splitView";

type Props = {
  /** The document currently rendered in the single mobile pane. */
  document: Document;
};

/**
 * Explains the mobile limitation of the bilingual view and links to the
 * translation. Side by side panes are a desktop layout, so on a phone the
 * route renders the source document only – without this notice the
 * translation would look lost.
 */
export default observer(function BilingualMobileBanner({
  document,
}: Props) {
  const { t } = useTranslation();
  const isMobile = useMobile();
  const { documents } = useStores();
  const bilingual = useBilingualPair();

  const pair = bilingual.pair;
  if (!isMobile || !bilingual.active || !pair) {
    return null;
  }

  // Only the source side explains the limitation, the mirror side is the
  // translation the user asked for.
  if (pair.sourceDocumentId !== document.id) {
    return null;
  }

  const target = documents.get(pair.targetDocumentId);
  if (!target) {
    return null;
  }

  return (
    <Banner role="note">
      <Text>{t("The side by side bilingual view is available on desktop.")}</Text>
      <OpenButton
        type="button"
        onClick={() => {
          // Leaving the pair is a plain full-width navigation: neither the
          // bilingual flag nor the split parameter should survive it.
          withoutSplitViewNavigation(() => {
            history.push({
              pathname: documentPath(target),
              search: "",
            });
          });
        }}
      >
        {t("Open the translation")}
      </OpenButton>
    </Banner>
  );
});

const Banner = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 16px 0;
  padding: 8px 12px;
  border: 1px solid ${s("divider")};
  border-radius: 6px;
  background: ${s("backgroundSecondary")};
  font-size: 13px;
`;

const Text = styled.span`
  flex: 1;
  color: ${s("textSecondary")};
`;

const OpenButton = styled.button`
  background: none;
  border: none;
  color: ${s("accent")};
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
`;
