import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Logger from "@server/logging/Logger";
import { translateWithFallback } from "./registry";

/**
 * Local ECDICT-first word dictionary, ported from the FluentRead web
 * dictionary module (FluentRead/web/wordDictionary.ts): lazily indexed
 * bundled core vocabulary, word-form lemmatization with per-form fallback,
 * and an honest machine-translation fallback when the dictionary misses.
 * All objects live in the repo; no extension runtime dependencies.
 */

/** Compact ECDICT row: [word, phonetic, en definitions (\n separated), zh definitions (\n separated)]. */
type EcdictRow = readonly [string, string, string, string];

/** A single sense: part of speech + Chinese meaning + optional original English. */
export interface WordSense {
  pos: string;
  zh?: string;
  en?: string;
}

export interface WordLookupResult {
  term: string;
  /** Whether the dictionary hit (false means translation came from machine translation). */
  found: boolean;
  source: "ecdict" | "mt-fallback";
  /** The dictionary form matched by lemmatization (omitted when same as query). */
  lemma?: string;
  phonetic?: string;
  pos?: string;
  senses: WordSense[];
  /** Preferred Chinese meaning; the machine translation on dictionary miss. */
  translation: string;
}

const MAX_TERM_LENGTH = 64;
const MAX_SENSES = 6;
const ECDICT_FILE = path.resolve(__dirname, "../data/ecdict-core.json");

/** Part-of-speech prefix (e.g. "n. " / "adj. "); unmatched rows are treated as pos-less. */
const POS_PREFIX = /^\s*([a-zA-Z]{1,8}\.)\s*(.+)$/u;

let indexPromise: Promise<Map<string, EcdictRow>> | null = null;

/**
 * Lazily loads and indexes the bundled ECDICT core vocabulary.
 *
 * @returns A map of lowercase word to its dictionary row.
 */
async function loadEcdictIndex(): Promise<Map<string, EcdictRow>> {
  const raw = await readFile(ECDICT_FILE, "utf8");
  const rows = JSON.parse(raw) as EcdictRow[];
  const index = new Map<string, EcdictRow>();

  for (const row of rows) {
    index.set(row[0].toLowerCase(), row);
  }

  Logger.info("utils", `ECDICT index loaded (${index.size} words)`);
  return index;
}

/**
 * Parses a definition block ("pos. meaning" lines) into senses.
 *
 * @param value The raw definition block.
 * @returns Parsed parts-of-speech and texts.
 */
function parseDefinitionLines(value: string): Array<{ pos?: string; text: string }> {
  const lines = value.split("\n").filter((line) => line.trim());
  const parsed = lines.map((line) => {
    const match = line.match(POS_PREFIX);
    return match ? { pos: match[1], text: match[2] } : { text: line };
  });
  // Too many raw dictionary lines are noise; keep the leading few.
  return parsed.slice(0, 3);
}

/**
 * Builds the merged sense list from the English and Chinese definition blocks.
 *
 * @param enBlock The English definitions.
 * @param zhBlock The Chinese definitions.
 * @returns Up to MAX_SENSES merged senses.
 */
function buildSenses(enBlock: string, zhBlock: string): WordSense[] {
  const en = parseDefinitionLines(enBlock);
  const zh = parseDefinitionLines(zhBlock);
  const senses: WordSense[] = [];
  const count = Math.max(en.length, zh.length);

  for (let i = 0; i < count && senses.length < MAX_SENSES; i++) {
    const sense: WordSense = { pos: "" };
    if (zh[i]?.pos) {
      sense.pos = zh[i].pos as string;
    } else if (en[i]?.pos) {
      sense.pos = en[i].pos as string;
    }
    if (zh[i]?.text) {
      sense.zh = zh[i].text;
    }
    if (en[i]?.text) {
      sense.en = en[i].text;
    }
    senses.push(sense);
  }

  return senses;
}

/**
 * Generates dictionary-form candidates for an inflected word (plurals,
 * verb endings), most likely first.
 *
 * @param term The query word in lowercase.
 * @returns Candidate forms, starting with the term itself.
 */
export function wordFormCandidates(term: string): string[] {
  const forms = [term];

  if (term.endsWith("ies") && term.length > 4) {
    forms.push(term.slice(0, -3) + "y");
  }
  if (term.endsWith("es") && term.length > 3) {
    forms.push(term.slice(0, -2));
  }
  if (term.endsWith("s") && term.length > 3) {
    forms.push(term.slice(0, -1));
  }
  if (term.endsWith("ing") && term.length > 5) {
    forms.push(term.slice(0, -3), term.slice(0, -3) + "e");
  }
  if (term.endsWith("ied") && term.length > 4) {
    forms.push(term.slice(0, -3) + "y");
  }
  if (term.endsWith("ed") && term.length > 4) {
    forms.push(term.slice(0, -2), term.slice(0, -1));
  }
  if (term.endsWith("est") && term.length > 5) {
    forms.push(term.slice(0, -3), term.slice(0, -3) + "e");
  }
  if (term.endsWith("er") && term.length > 4) {
    forms.push(term.slice(0, -2), term.slice(0, -1));
  }

  return [...new Set(forms)];
}

/**
 * Looks a word up: ECDICT local dictionary first (with lemmatization),
 * machine translation as the honest fallback.
 *
 * @param rawTerm The query word.
 * @param from Source language hint for the fallback translation.
 * @param to Target language for the fallback translation.
 * @returns The lookup result with its source labeled.
 */
export async function lookupWord(
  rawTerm: string,
  from: string,
  to: string
): Promise<WordLookupResult> {
  const term = rawTerm.trim().toLowerCase().slice(0, 64);

  if (!term) {
    return { term: rawTerm, found: false, source: "mt-fallback", senses: [], translation: rawTerm };
  }

  const index = await loadEcdictIndex();

  for (const form of wordFormCandidates(term)) {
    const row = index.get(form);

    if (!row) {
      continue;
    }

    const senses = buildSenses(row[3], row[2]);
    const firstZh = senses.find((sense) => sense.zh)?.zh ?? "";

    return {
      term: rawTerm,
      found: true,
      source: "ecdict",
      ...(form !== term ? { lemma: form } : {}),
      ...(row[1] ? { phonetic: row[1] } : {}),
      ...(senses[0]?.pos ? { pos: senses[0].pos } : {}),
      senses,
      translation: firstZh || row[3].split("\n")[0] || form,
    };
  }

  // Dictionary miss: free/AI translation fallback, honestly labeled.
  const results = await translateWithFallback([rawTerm], from, to, new AbortController().signal);
  return {
    term: rawTerm,
    found: false,
    source: "mt-fallback",
    senses: [],
    translation: results.results[0] ?? rawTerm,
  };
}

/**
 * Cache key for a word lookup result.
 *
 * @param word The query word.
 * @param to The target language.
 * @returns The cache key.
 */
export function wordCacheKey(word: string, to: string): string {
  return `word-lookup:${to}:${createHash("sha256").update(word).digest("hex")}`;
}
