import { observer } from "mobx-react";
import { GlobeIcon } from "outline-icons";
import * as React from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { breakpoint } from "@shared/styles/breakpoint";
import { s } from "@shared/styles";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import CopyToClipboard from "~/components/CopyToClipboard";
import Flex from "~/components/Flex";
import Heading from "~/components/Heading";
import Input from "~/components/Input";
import LoadingIndicator from "~/components/LoadingIndicator";
import Scene from "~/components/Scene";
import Text from "~/components/Text";
import useCurrentTeam from "~/hooks/useCurrentTeam";
import { client } from "~/utils/ApiClient";

/** Delay after the last keystroke before a translation is requested. */
const DEBOUNCE_MS = 1000;
const MAX_LENGTH = 5000;

function Translate() {
  const { t } = useTranslation();
  const team = useCurrentTeam();

  const [text, setText] = React.useState("");
  const [translated, setTranslated] = React.useState("");
  const [engine, setEngine] = React.useState<string | null>(null);
  const [isLoading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Increments with every request so stale responses can be discarded.
  const requestSeq = React.useRef(0);

  const translate = React.useCallback(async (value: string) => {
    const seq = ++requestSeq.current;

    setLoading(true);
    setError(null);

    try {
      const res = await client.post("/translations.translate", {
        text: value,
      });

      if (seq !== requestSeq.current) {
        return;
      }
      setTranslated(res.data.text);
      setEngine(typeof res.data.engine === "string" ? res.data.engine : null);
    } catch (err) {
      if (seq !== requestSeq.current) {
        return;
      }
      setError(errToString(err));
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    if (!text.trim()) {
      return;
    }

    const timer = setTimeout(() => void translate(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, translate]);

  const handleChange = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const value = ev.target.value;
      setText(value);

      // Clearing the input invalidates any pending or displayed translation.
      if (!value.trim()) {
        requestSeq.current++;
        setTranslated("");
        setEngine(null);
        setError(null);
        setLoading(false);
      }
    },
    []
  );

  const handleRequestSubmit = React.useCallback(() => {
    if (text.trim()) {
      void translate(text);
    }
  }, [text, translate]);

  let result: React.ReactNode;

  if (isLoading) {
    result = <LoadingIndicator />;
  } else if (error) {
    result = (
      <Placeholder>
        <Text type="secondary">{error}</Text>
      </Placeholder>
    );
  } else {
    result = (
      <>
        <Output>{translated}</Output>
        {translated && (
          <Flex justify="flex-end">
            <CopyToClipboard text={translated}>
              <Button neutral>{t("Copy")}</Button>
            </CopyToClipboard>
          </Flex>
        )}
      </>
    );
  }

  return (
    <Scene icon={<GlobeIcon />} title={t("Translate")} wide>
      <Heading>{t("Translate")}</Heading>
      <Text as="p" type="secondary">
        {t("Type text on the left, the translation appears on the right.")}
      </Text>

      <Panes>
        <Pane column>
          <PaneHeader>
            <Text type="tertiary" size="xsmall">
              {t("Original")}
            </Text>
            <Text type="tertiary" size="xsmall">
              {text.length}/{MAX_LENGTH}
            </Text>
          </PaneHeader>
          <Input
            type="textarea"
            value={text}
            onChange={handleChange}
            onRequestSubmit={handleRequestSubmit}
            placeholder={t("Type to translate…")}
            maxLength={MAX_LENGTH}
            autoSize
            minHeight="40vh"
          />
          <Flex justify="flex-end">
            <Button
              neutral
              onClick={handleRequestSubmit}
              disabled={!text.trim() || isLoading}
            >
              {isLoading ? `${t("Translating")}…` : t("Translate")}
            </Button>
          </Flex>
        </Pane>
        <Pane column>
          <PaneHeader>
            <Text type="tertiary" size="xsmall">
              {t("Translation")}
            </Text>
            <Flex gap={8}>
              {engine && (
                <Text type="tertiary" size="xsmall">
                  {engine}
                </Text>
              )}
              {team.translation?.targetLanguage && (
                <Text type="tertiary" size="xsmall">
                  {team.translation.targetLanguage}
                </Text>
              )}
            </Flex>
          </PaneHeader>
          {result}
        </Pane>
      </Panes>
    </Scene>
  );
}

const Panes = styled(Flex)`
  gap: 24px;
  margin-top: 16px;
  align-items: stretch;

  ${breakpoint("mobile", "tablet")`
    flex-direction: column;
  `};
`;

const Pane = styled(Flex)`
  flex: 1;
  min-width: 0;
  gap: 8px;
`;

const PaneHeader = styled(Flex)`
  justify-content: space-between;
`;

const Output = styled.div`
  white-space: pre-wrap;
  min-height: 40vh;
  padding: 16px;
  border-radius: 4px;
  background: ${s("backgroundSecondary")};
  color: ${s("text")};
  font-size: 16px;
  line-height: 1.6;
`;

const Placeholder = styled(Flex)`
  min-height: 40vh;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 12px;
  padding: 16px;
  border-radius: 4px;
  background: ${s("backgroundSecondary")};
  flex-direction: column;
`;

export default observer(Translate);
