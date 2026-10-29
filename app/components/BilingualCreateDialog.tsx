import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import ConfirmationDialog from "~/components/ConfirmationDialog";
import Input from "~/components/Input";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import useStores from "~/hooks/useStores";
import styled from "styled-components";

/**
 * Props for the bilingual creation form.
 */
export interface BilingualCreateFormProps {
  /** Creates the pair with the chosen title and collection. The caller is
   * responsible for navigating into the bilingual view afterwards. */
  onSubmit: (title: string, collectionId: string | null) => Promise<void>;
}

/**
 * Guided creation of a bilingual document: a title and the collection to
 * place the source document in. The mirror document is created
 * automatically as the pair is set up. Rendered inside a modal via
 * dialogs.openModal.
 */
export const BilingualCreateForm = observer(function BilingualCreateForm({
  onSubmit,
}: BilingualCreateFormProps) {
  const { t } = useTranslation();
  const { collections } = useStores();
  const [title, setTitle] = React.useState("");
  const [collectionId, setCollectionId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setCollectionId(collections.personal?.id ?? null);
  }, [collections]);

  const options = React.useMemo<Option[]>(
    () =>
      collections.orderedData
        .filter((collection) => collection.isActive)
        .map((collection) => ({
          type: "item" as const,
          label: collection.name,
          value: collection.id,
        })),
    [collections]
  );

  return (
    <ConfirmationDialog
      onSubmit={() => onSubmit(title.trim(), collectionId)}
      submitText={t("Create")}
      disabled={!title.trim()}
    >
      <Field>
        <Label>{t("Title")}</Label>
        <Input
          value={title}
          placeholder={t("e.g. Product requirements")}
          onChange={(event) => setTitle(event.currentTarget.value)}
          autoFocus
        />
      </Field>
      <Field>
        <Label>{t("Collection")}</Label>
        <InputSelect
          value={collectionId}
          options={options}
          onChange={setCollectionId}
          label={t("Collection")}
          labelHidden
        />
      </Field>
    </ConfirmationDialog>
  );
});

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
`;

const Label = styled.div`
  font-size: 13px;
  font-weight: 500;
`;
