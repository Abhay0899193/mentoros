import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchLeetCodeProblem,
  htmlToMarkdown,
  LeetCodeFetchError,
  LeetCodeNotFound,
  slugFromLeetCodeUrl,
} from "./leetcode.js";

/* ------------------------------ slug parse ----------------------------- */

test("slugFromLeetCodeUrl: extracts the titleSlug across url shapes", () => {
  assert.equal(slugFromLeetCodeUrl("https://leetcode.com/problems/two-sum/"), "two-sum");
  assert.equal(slugFromLeetCodeUrl("https://leetcode.com/problems/two-sum"), "two-sum");
  assert.equal(
    slugFromLeetCodeUrl("https://leetcode.com/problems/two-sum/description/"),
    "two-sum",
  );
  assert.equal(
    slugFromLeetCodeUrl("https://www.leetcode.com/problems/two-sum?envType=x&tab=y"),
    "two-sum",
  );
  assert.equal(
    slugFromLeetCodeUrl("https://leetcode.com/problems/coin-change/#solution"),
    "coin-change",
  );
  assert.equal(
    slugFromLeetCodeUrl("https://leetcode.com/problems/longest-substring-without-repeating-characters/"),
    "longest-substring-without-repeating-characters",
  );
});

test("slugFromLeetCodeUrl: rejects non-LeetCode / malformed urls → null", () => {
  assert.equal(slugFromLeetCodeUrl("https://example.com/problems/two-sum"), null);
  assert.equal(slugFromLeetCodeUrl("https://leetcode.com/contest/weekly/"), null);
  assert.equal(slugFromLeetCodeUrl("https://leetcode.com/problems/"), null);
  assert.equal(slugFromLeetCodeUrl("not a url"), null);
  assert.equal(slugFromLeetCodeUrl(""), null);
  assert.equal(slugFromLeetCodeUrl("leetcode.com/problems/two-sum"), null); // no scheme → not a URL
});

/* ---------------------------- HTML → markdown -------------------------- */

const LC_CONTENT = [
  "<p>Given an array of integers <code>nums</code>&nbsp;and an integer <code>target</code>, return <em>indices of the two numbers such that they add up to <code>target</code></em>.</p>",
  "<p>You may assume that each input would have <strong>exactly one solution</strong>.</p>",
  "<p>&nbsp;</p>",
  "<p><strong>Example 1:</strong></p>",
  "<pre><strong>Input:</strong> nums = [2,7,11,15], target = 9",
  "<strong>Output:</strong> [0,1]",
  "<strong>Explanation:</strong> Because nums[0] + nums[1] == 9, we return [0, 1].",
  "</pre>",
  "<p>&nbsp;</p>",
  "<p><strong>Constraints:</strong></p>",
  "<ul>",
  "\t<li><code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>",
  "\t<li><code>-10<sup>9</sup> &lt;= nums[i] &lt;= 10<sup>9</sup></code></li>",
  "</ul>",
].join("\n");

test("htmlToMarkdown: converts a realistic LC statement deterministically", () => {
  const md = htmlToMarkdown(LC_CONTENT);

  // Emphasis.
  assert.ok(md.includes("**Example 1:**"), "strong → bold");
  assert.ok(md.includes("**Constraints:**"));
  assert.ok(md.includes("**exactly one solution**"));
  assert.ok(md.includes("*indices of the two numbers"), "em → italic");

  // Inline code.
  assert.ok(md.includes("`nums`"), "code → inline backticks");

  // Fenced example block, content preserved.
  assert.ok(md.includes("```"), "pre → fenced block");
  assert.ok(md.includes("Input: nums = [2,7,11,15], target = 9"));
  assert.ok(md.includes("Output: [0,1]"));

  // Superscript survives even inside <code> (10<sup>4</sup> → 10^4).
  assert.ok(md.includes("10^4"), "sup → ^ inside code");
  assert.ok(md.includes("2 <= nums.length <= 10^4"), "entities decoded inside code");

  // Bullets.
  assert.ok(/\n- /.test(md), "li → '- ' bullets");

  // No raw entities / tags leak.
  assert.ok(!md.includes("&lt;") && !md.includes("&nbsp;"), "entities decoded");
  assert.ok(!/<[a-z/]/i.test(md), "no residual tags");
});

test("htmlToMarkdown: empty / non-string input → ''", () => {
  assert.equal(htmlToMarkdown(""), "");
  assert.equal(htmlToMarkdown(undefined as unknown as string), "");
});

/* -------------------------------- fetch -------------------------------- */

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

test("fetchLeetCodeProblem: normalizes the GraphQL payload (starters, difficulty)", async () => {
  const impl = fakeFetch({
    data: {
      question: {
        title: "Two Sum",
        content: "<p>Given <code>nums</code> and <code>target</code>.</p>",
        difficulty: "Easy",
        exampleTestcases: "[2,7,11,15]\n9",
        codeSnippets: [
          { langSlug: "python3", code: "class Solution:\n    def twoSum(self, nums, target):\n        pass" },
          { langSlug: "javascript", code: "var twoSum = function(nums, target) {};" },
          { langSlug: "cpp", code: "// ignored" },
        ],
      },
    },
  });
  const res = await fetchLeetCodeProblem("two-sum", impl);
  assert.equal(res.title, "Two Sum");
  assert.equal(res.difficulty, "easy", "difficulty lowercased");
  assert.equal(res.exampleTestcases, "[2,7,11,15]\n9");
  assert.ok(res.statementMarkdown.includes("`nums`"));
  assert.ok(res.pythonStarter?.includes("def twoSum"));
  assert.ok(res.jsStarter?.includes("twoSum"));
});

test("fetchLeetCodeProblem: unknown slug (null question) → LeetCodeNotFound", async () => {
  const impl = fakeFetch({ data: { question: null } });
  await assert.rejects(() => fetchLeetCodeProblem("no-such-problem", impl), LeetCodeNotFound);
});

test("fetchLeetCodeProblem: non-2xx response → LeetCodeFetchError", async () => {
  const impl = fakeFetch({}, false, 503);
  await assert.rejects(() => fetchLeetCodeProblem("two-sum", impl), LeetCodeFetchError);
});

test("fetchLeetCodeProblem: network throw → LeetCodeFetchError", async () => {
  const impl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as unknown as typeof fetch;
  await assert.rejects(() => fetchLeetCodeProblem("two-sum", impl), LeetCodeFetchError);
});
