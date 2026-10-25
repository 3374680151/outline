import { observer } from "mobx-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import styled from "styled-components";
import { GRAMMAR_AUTO_DETECT } from "@shared/constants";
import { s } from "@shared/styles";
import { UserPreference } from "@shared/types";
import { errToString } from "@shared/utils/error";
import Button from "~/components/Button";
import Flex from "~/components/Flex";
import Input from "~/components/Input";
import type { Option } from "~/components/InputSelect";
import { InputSelect } from "~/components/InputSelect";
import Switch from "~/components/Switch";
import Text from "~/components/Text";
import useCurrentUser from "~/hooks/useCurrentUser";
import { client } from "~/utils/ApiClient";
import SettingRow from "./SettingRow";

/** A language supported by the grammar service. */
interface GrammarLanguage {
  name: string;
  code: string;
  longCode: string;
}

/** A rule of a language as listed by the grammar service. */
interface GrammarRule {
  ruleId: string;
  description?: string;
  isDefaultOff?: string;
  categoryId?: string;
  categoryName?: string;
  locQualityIssueType?: string;
}

/** A checkable rule category of a language. */
interface GrammarCategory {
  id: string;
  name: string;
}

/** Language whose categories are listed when checking auto-detects. */
const DEFAULT_CATEGORY_LANGUAGE = "en-US";

/**
 * The grammar checking section of the preferences: the check language, the
 * strictness, and the category, rule and dictionary management.
 */
function GrammarSettings() {
  const { t } = useTranslation();
  const user = useCurrentUser();

  const [languages, setLanguages] = React.useState<GrammarLanguage[] | null>(
    null
  );
  const [categoriesByLanguage, setCategoriesByLanguage] = React.useState<
    Record<string, GrammarCategory[]>
  >({});
  const [error, setError] = React.useState<string | null>(null);
  const [newWord, setNewWord] = React.useState("");

  const checkLanguage = user.getPreference(UserPreference.GrammarLanguage);
  const [categoryLanguage, setCategoryLanguage] = React.useState(
    checkLanguage === GRAMMAR_AUTO_DETECT
      ? DEFAULT_CATEGORY_LANGUAGE
      : checkLanguage
  );
  const categories = categoriesByLanguage[categoryLanguage];

  React.useEffect(() => {
    let alive = true;
    client
      .post<{ data: { languages: GrammarLanguage[] } }>("/grammar.languages")
      .then((res) => {
        if (alive) {
          setLanguages(res.data.languages);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(errToString(err));
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    // Already listed, or a request for this language is already running.
    if (categoriesByLanguage[categoryLanguage]) {
      return;
    }
    let alive = true;
    client
      .post<{ data: { rules: GrammarRule[] } }>("/grammar.config", {
        language: categoryLanguage,
      })
      .then((res) => {
        if (!alive) {
          return;
        }
        const seen = new Map<string, GrammarCategory>();

        for (const rule of res.data.rules) {
          if (rule.categoryId && rule.categoryName) {
            seen.set(rule.categoryId, {
              id: rule.categoryId,
              name: rule.categoryName,
            });
          }
        }

        setCategoriesByLanguage((current) => ({
          ...current,
          [categoryLanguage]: [...seen.values()],
        }));
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(errToString(err));
        }
      });

    return () => {
      alive = false;
    };
  }, [categoryLanguage, categoriesByLanguage]);

  const save = React.useCallback(async () => {
    await user.save();
    toast.success(t("Preferences saved"));
  }, [user, t]);

  const handleCheckLanguageChange = React.useCallback(
    async (value: string) => {
      user.setPreference(UserPreference.GrammarLanguage, value);
      await save();
    },
    [user, save]
  );

  const handleMotherTongueChange = React.useCallback(
    async (value: string) => {
      user.setPreference(UserPreference.GrammarMotherTongue, value);
      await save();
    },
    [user, save]
  );

  const handlePickyChange = React.useCallback(
    async (checked: boolean) => {
      user.setPreference(UserPreference.GrammarPickyLevel, checked);
      await save();
    },
    [user, save]
  );

  const handleAutoCheckChange = React.useCallback(
    async (checked: boolean) => {
      user.setPreference(UserPreference.GrammarAutoCheck, checked);
      await save();
    },
    [user, save]
  );

  const handleCategoryChange = React.useCallback(
    async (categoryId: string, checked: boolean) => {
      const current =
        user.preferences?.[UserPreference.GrammarDisabledCategories] ?? [];
      const next = checked
        ? current.filter((id) => id !== categoryId)
        : [...current, categoryId];
      user.setPreference(UserPreference.GrammarDisabledCategories, next);
      await save();
    },
    [user, save]
  );

  const handleReenableRule = React.useCallback(
    async (ruleId: string) => {
      const current =
        user.preferences?.[UserPreference.GrammarDisabledRules] ?? [];
      user.setPreference(
        UserPreference.GrammarDisabledRules,
        current.filter((id) => id !== ruleId)
      );
      await save();
    },
    [user, save]
  );

  const handleAddWord = React.useCallback(async () => {
    const word = newWord.trim();

    if (!word) {
      return;
    }

    const current = user.preferences?.[UserPreference.GrammarDictionary] ?? [];

    if (!current.includes(word)) {
      user.setPreference(UserPreference.GrammarDictionary, [...current, word]);
      await save();
    }

    setNewWord("");
  }, [user, save, newWord]);

  const handleRemoveWord = React.useCallback(
    async (word: string) => {
      const current =
        user.preferences?.[UserPreference.GrammarDictionary] ?? [];
      user.setPreference(
        UserPreference.GrammarDictionary,
        current.filter((item) => item !== word)
      );
      await save();
    },
    [user, save]
  );

  const languageOptions: Option[] = React.useMemo(() => {
    const options: Option[] = [
      { type: "item", label: t("Auto-detect"), value: GRAMMAR_AUTO_DETECT },
    ];

    for (const language of languages ?? []) {
      options.push({
        type: "item",
        label: language.name,
        value: language.longCode,
      });
    }

    return options;
  }, [languages, t]);

  const motherTongueOptions: Option[] = React.useMemo(
    () =>
      (languages ?? []).map(
        (language) =>
          ({
            type: "item",
            label: language.name,
            value: language.longCode,
          }) satisfies Option
      ),
    [languages]
  );

  const strictnessOptions: Option[] = React.useMemo(
    () =>
      [
        { type: "item", label: t("Standard"), value: "default" },
        { type: "item", label: t("Strict"), value: "picky" },
      ] satisfies Option[],
    [t]
  );

  const categoryLanguageOptions: Option[] = React.useMemo(
    () =>
      (languages ?? []).map(
        (language) =>
          ({
            type: "item",
            label: language.name,
            value: language.longCode,
          }) satisfies Option
      ),
    [languages]
  );

  const disabledCategories =
    user.preferences?.[UserPreference.GrammarDisabledCategories] ?? [];
  const disabledRules =
    user.preferences?.[UserPreference.GrammarDisabledRules] ?? [];
  const dictionary = user.preferences?.[UserPreference.GrammarDictionary] ?? [];

  if (error) {
    return (
      <SettingRow
        name="grammar-error"
        label={t("Grammar checking")}
        border={false}
      >
        <Text type="secondary" size="small">
          {error}
        </Text>
      </SettingRow>
    );
  }

  return (
    <>
      <SettingRow
        name={UserPreference.GrammarLanguage}
        label={t("Check language")}
        description={t(
          "The language grammar checking runs against. Automatic detection checks each paragraph in the language it is written in."
        )}
      >
        <InputSelect
          options={languageOptions}
          value={checkLanguage}
          onChange={handleCheckLanguageChange}
          label={t("Check language")}
          labelHidden
        />
      </SettingRow>
      <SettingRow
        name={UserPreference.GrammarMotherTongue}
        label={t("Mother tongue")}
        description={t(
          "Your native language. It is used to warn about words that are easily confused with your mother tongue."
        )}
      >
        <InputSelect
          options={motherTongueOptions}
          value={
            user.preferences?.[UserPreference.GrammarMotherTongue] ?? undefined
          }
          onChange={handleMotherTongueChange}
          label={t("Mother tongue")}
          labelHidden
          displayValue={(option) => option?.label ?? t("Not set")}
        />
      </SettingRow>
      <SettingRow
        name={UserPreference.GrammarPickyLevel}
        label={t("Strictness")}
        description={t(
          "Strict checking also reports picky style and punctuation rules."
        )}
      >
        <InputSelect
          options={strictnessOptions}
          value={
            user.getPreference(UserPreference.GrammarPickyLevel)
              ? "picky"
              : "default"
          }
          onChange={(value) => void handlePickyChange(value === "picky")}
          label={t("Strictness")}
          labelHidden
        />
      </SettingRow>
      <SettingRow
        name={UserPreference.GrammarAutoCheck}
        label={t("Check while typing")}
        description={t(
          "Automatically check the document for issues while you write."
        )}
      >
        <Switch
          id={UserPreference.GrammarAutoCheck}
          name={UserPreference.GrammarAutoCheck}
          checked={user.getPreference(UserPreference.GrammarAutoCheck)}
          onChange={handleAutoCheckChange}
        />
      </SettingRow>
      <SettingRow
        name="grammar-categories"
        label={t("Categories")}
        description={t(
          "Turn the rule categories of a language on or off. Disabled categories are skipped when checking."
        )}
      >
        <Flex column gap={8}>
          <InputSelect
            options={categoryLanguageOptions}
            value={categoryLanguage}
            onChange={setCategoryLanguage}
            label={t("Categories")}
            labelHidden
            short
          />
          <CategoryList column gap={2}>
            {(categories ?? []).map((category) => (
              <CategoryRow key={category.id} justify="space-between">
                <Text size="small">{category.name}</Text>
                <Switch
                  id={`grammar-category-${category.id}`}
                  name={`grammar-category-${category.id}`}
                  checked={!disabledCategories.includes(category.id)}
                  onChange={(checked) =>
                    void handleCategoryChange(category.id, checked)
                  }
                />
              </CategoryRow>
            ))}
            {categories === undefined && (
              <Text type="secondary" size="small">
                {t("Loading")}…
              </Text>
            )}
          </CategoryList>
        </Flex>
      </SettingRow>
      <SettingRow
        name="grammar-rules"
        label={t("Ignored rules")}
        description={t(
          "Rules you have turned off from an issue card. Re-enable them to check them again."
        )}
      >
        {disabledRules.length > 0 ? (
          <Flex column gap={4}>
            {disabledRules.map((ruleId) => (
              <IgnoredRow key={ruleId} justify="space-between" align="center">
                <Text size="small" type="secondary">
                  {ruleId}
                </Text>
                <Button neutral onClick={() => void handleReenableRule(ruleId)}>
                  {t("Re-enable")}
                </Button>
              </IgnoredRow>
            ))}
          </Flex>
        ) : (
          <Text type="secondary" size="small">
            {t("No rules are ignored.")}
          </Text>
        )}
      </SettingRow>
      <SettingRow
        name="grammar-dictionary"
        label={t("Personal dictionary")}
        description={t("Words that are never reported as misspellings.")}
        border={false}
      >
        <Flex column gap={8}>
          {dictionary.length > 0 && (
            <WordList gap={6} wrap>
              {dictionary.map((word) => (
                <WordChip
                  key={word}
                  onClick={() => void handleRemoveWord(word)}
                  title={t("Remove")}
                >
                  {word} ✕
                </WordChip>
              ))}
            </WordList>
          )}
          <Flex align="center" gap={8}>
            <Input
              value={newWord}
              onChange={(event) => setNewWord(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleAddWord();
                }
              }}
              placeholder={t("Add a word…")}
              flex
            />
            <Button neutral onClick={() => void handleAddWord()}>
              {t("Add")}
            </Button>
          </Flex>
        </Flex>
      </SettingRow>
    </>
  );
}

const CategoryList = styled(Flex)`
  border: 1px solid ${s("inputBorder")};
  border-radius: 6px;
  padding: 8px 10px;
  max-height: 240px;
  overflow-y: auto;
`;

const CategoryRow = styled(Flex)`
  align-items: center;
`;

const IgnoredRow = styled(Flex)``;

const WordList = styled(Flex)``;

const WordChip = styled.button`
  border: 1px solid ${s("inputBorder")};
  background: ${s("background")};
  color: ${s("text")};
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    border-color: ${s("danger")};
    color: ${s("danger")};
  }
`;

export default observer(GrammarSettings);
