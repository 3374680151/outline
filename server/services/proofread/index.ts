import { TeamPreference } from "@shared/types";
import type { ProofreadSuggestion } from "@shared/types/proofread";
import { Team } from "@server/models";
import { executeChat } from "@server/services/ai/adaptors";
import { resolveChatChannel } from "@server/services/ai/channel";
import { parseAndValidate, isPureCJK } from "./validate";

export { parseAndValidate, isPureCJK } from "./validate";

/**
 * The proofread system prompt, ported from the FluentRead-Go proofread
 * contract: verbatim fragments, enum categories, teaching reasons, no
 * rewriting.
 */
const PROOFREAD_SYSTEM_PROMPT = `你是英文写作老师，做纠错检查：逐条指出这段英文里的错误并讲清规则。只输出 JSON 数组，不要输出其他任何内容。
每个元素形如：
{"original":"逐字来自原文的片段","suggestion":"改法","category":"类别","reason":"一句话理由"}
规则：
1. original 必须是原文里逐字存在的片段（一个词或短语），禁止输出偏移量，禁止改写原文。
2. category 只能取：spelling、grammar、punctuation、style、word_choice。
3. reason 必须是教学解释：错在哪、规则是什么、为什么这样改，让作者能学到一条可复用的规则；禁止"表达欠佳"这类笼统评价。
4. 只报确定的错误，不报可选的润色；没有错误就输出 []。
5. 不做整段重写。`;

/** Sampling temperature for proofread calls: low, corrections must be sure. */
const TEMPERATURE = 0.1;

/** Output token budget for one proofread response. */
const MAX_TOKENS = 2048;

/** The resolved error code surfaced when no chat channel is configured. */
export const PROOFREAD_NOT_CONFIGURED = "proofread-not-configured";

/**
 * Runs the LLM proofread check for one piece of text.
 *
 * @param props The check description.
 * @param props.teamId The workspace, used to resolve the model channel.
 * @param props.text The text to check, at most one block.
 * @returns The validated suggestions; empty when the text is CJK or the
 *   model reports no errors.
 * @throws Error with a "not-configured" message when no model channel exists.
 * @throws Error when the upstream call fails.
 */
export async function proofread(props: {
  teamId: string;
  text: string;
}): Promise<{ suggestions: ProofreadSuggestion[] }> {
  const text = props.text.trim();

  if (!text) {
    return {
      suggestions: [],
    };
  }

  // CJK text is not English writing; report "no problems" without a call.
  if (isPureCJK(text)) {
    return {
      suggestions: [],
    };
  }

  const team = await Team.findByPk(props.teamId, { rejectOnEmpty: true });
  const binding = team.getPreference(TeamPreference.ProofreadModel);
  const channel = await resolveChatChannel(
    props.teamId,
    typeof binding === "string" && binding ? binding : undefined
  );

  if (!channel || !channel.model) {
    const err = new Error(PROOFREAD_NOT_CONFIGURED);
    err.name = PROOFREAD_NOT_CONFIGURED;
    throw err;
  }

  const response = await executeChat({
    baseUrl: channel.baseUrl,
    apiKey: channel.apiKey,
    protocol: channel.protocol,
    req: {
      model: channel.model,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      messages: [
        {
          role: "system",
          content: PROOFREAD_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: text,
        },
      ],
    },
  });

  return {
    suggestions: parseAndValidate(response.text, text),
  };
}
