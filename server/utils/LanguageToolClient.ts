import env from "@server/env";
import Logger from "@server/logging/Logger";
import fetch from "@server/utils/fetch";

/** The subset of a LanguageTool match that is exposed to clients. */
export interface GrammarMatch {
  /** Human readable explanation of the issue. */
  message: string;
  /** Short category label, when the rule provides one. */
  shortMessage?: string;
  /** Suggested replacements. */
  replacements: { value: string }[];
  /** UTF-16 code unit offset of the issue into the checked text. */
  offset: number;
  /** UTF-16 code unit length of the issue. */
  length: number;
  /** Text around the issue with the issue position inside it. */
  context: { text: string; offset: number; length: number };
  /** The full sentence containing the issue. */
  sentence?: string;
  /** Rule metadata. */
  rule: {
    id: string;
    description?: string;
    issueType?: string;
    category: { id: string; name: string };
    isPremium?: boolean;
  };
}

/** The checked parameters sent to LanguageTool. */
export interface GrammarCheckParams {
  /** The plain text to check. */
  text: string;
  /** Language long code, e.g. en-US. */
  language: string;
  /** Rule level, default or picky. */
  level?: string;
  /** Rule mode; textLevelOnly is faster for typing latency. */
  mode?: string;
  /** Comma separated rule ids to disable. */
  disabledRules?: string;
  /** Whether only the enabled rules should run. */
  enabledOnly?: boolean;
  /** Comma separated rule ids to enable (requires enabledOnly). */
  enabledRules?: string;
}

/** Result of a check attempt. */
export type GrammarCheckResult =
  | { available: true; matches: GrammarMatch[]; language: string }
  | { available: false; reason: string };

/**
 * Client for a self-hosted LanguageTool server with a simple circuit
 * breaker: after repeated failures the client short-circuits for a cool down
 * period so the editor never stalls on a dead sidecar.
 */
class LanguageToolClient {
  /** Consecutive failures before the breaker opens. */
  private static failureThreshold = 3;

  /** Duration the breaker stays open after tripping. */
  private static breakerOpenMs = 30000;

  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;

  /**
   * Whether a LanguageTool server is configured for this installation.
   *
   * @returns True when grammar checking is usable.
   */
  public get isConfigured(): boolean {
    return !!env.LANGUAGETOOL_URL && env.GRAMMAR_CHECKING_ENABLED;
  }

  /**
   * Whether a LanguageTool server is reachable for a workspace, taking a
   * workspace level URL override into account.
   *
   * @param baseUrlOverride The workspace configured server URL, if any.
   * @returns True when grammar checking is usable.
   */
  public isConfiguredFor(baseUrlOverride?: string | null): boolean {
    if (!env.GRAMMAR_CHECKING_ENABLED) {
      return false;
    }

    return !!(baseUrlOverride || env.LANGUAGETOOL_URL);
  }

  /**
   * Checks text against the LanguageTool server, applying the circuit
   * breaker. Response matches are whitelisted to the fields clients need.
   *
   * @param params The check parameters.
   * @param options Optional overrides, e.g. a workspace configured server URL.
   * @returns The whitelisted matches, or an unavailable result.
   */
  public async check(
    params: GrammarCheckParams,
    options?: { baseUrl?: string | null }
  ): Promise<GrammarCheckResult> {
    const baseUrl = options?.baseUrl || env.LANGUAGETOOL_URL;

    if (!baseUrl || !env.GRAMMAR_CHECKING_ENABLED) {
      return { available: false, reason: "not-configured" };
    }

    if (Date.now() < this.breakerOpenUntil) {
      return { available: false, reason: "circuit-open" };
    }

    const body = new URLSearchParams({
      text: params.text,
      language: params.language,
      ...(params.level ? { level: params.level } : {}),
      ...(params.mode ? { mode: params.mode } : {}),
      ...(params.disabledRules ? { disabledRules: params.disabledRules } : {}),
      ...(params.enabledOnly
        ? {
            enabledOnly: "true",
            ...(params.enabledRules
              ? { enabledRules: params.enabledRules }
              : {}),
          }
        : {}),
    });

    try {
      const response = await fetch(`${baseUrl}/v2/check`, {
        method: "POST",
        timeout: env.LANGUAGETOOL_TIMEOUT_MS,
        allowPrivateIPAddress: true,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`LanguageTool responded ${response.status}`);
      }

      const data = (await response.json()) as {
        language: { code: string };
        matches: Record<string, unknown>[];
      };

      this.consecutiveFailures = 0;

      return {
        available: true,
        language: data.language?.code ?? params.language,
        matches: data.matches.map(whitelistMatch),
      };
    } catch (err) {
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= LanguageToolClient.failureThreshold) {
        this.breakerOpenUntil =
          Date.now() + LanguageToolClient.breakerOpenMs;
        this.consecutiveFailures = 0;
        Logger.warn(
          "LanguageTool circuit breaker opened after repeated failures"
        );
      }

      Logger.warn("LanguageTool check failed", { err });
      return { available: false, reason: "upstream-error" };
    }
  }

  /**
   * Warms the LanguageTool server by issuing a small check so the first real
   * request does not pay the language loading cost. Failures are swallowed.
   */
  public async warmup(): Promise<void> {
    if (!this.isConfigured) {
      return;
    }

    try {
      await this.check({
        text: "This is a warm up sentence used to load the language.",
        language: "en-US",
      });
      Logger.info("utils", "LanguageTool warmup complete");
    } catch (err) {
      Logger.warn("LanguageTool warmup failed", { err });
    }
  }
}

/**
 * Reduces a raw LanguageTool match to the whitelisted client shape.
 *
 * @param match The raw match object from the LanguageTool response.
 * @returns The whitelisted match.
 */
function whitelistMatch(match: Record<string, unknown>): GrammarMatch {
  const rule = match.rule as
    | {
        id?: string;
        description?: string;
        issueType?: string;
        category?: { id?: string; name?: string };
        isPremium?: boolean;
      }
    | undefined;

  return {
    message: String(match.message ?? ""),
    ...(typeof match.shortMessage === "string"
      ? { shortMessage: match.shortMessage }
      : {}),
    replacements: Array.isArray(match.replacements)
      ? (match.replacements as { value?: string }[]).map((replacement) => ({
          value: String(replacement?.value ?? ""),
        }))
      : [],
    offset: Number(match.offset ?? 0),
    length: Number(match.length ?? 0),
    context: {
      text: String(
        (match.context as { text?: string } | undefined)?.text ?? ""
      ),
      offset: Number(
        (match.context as { offset?: number } | undefined)?.offset ?? 0
      ),
      length: Number(
        (match.context as { length?: number } | undefined)?.length ?? 0
      ),
    },
    ...(typeof match.sentence === "string" ? { sentence: match.sentence } : {}),
    rule: {
      id: String(rule?.id ?? ""),
      ...(rule?.description ? { description: rule.description } : {}),
      ...(rule?.issueType ? { issueType: rule.issueType } : {}),
      category: {
        id: String(rule?.category?.id ?? ""),
        name: String(rule?.category?.name ?? ""),
      },
      ...(rule?.isPremium !== undefined
        ? { isPremium: rule.isPremium }
        : {}),
    },
  };
}

export default new LanguageToolClient();
