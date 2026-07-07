import type {
  InterviewLanguage,
  InterviewProblem,
  InterviewProblemMeta,
} from "../types.js";

/**
 * Static coding-interview problem bank (§4.5, plan.md Part 9 = realistic seed).
 * Ten LeetCode classics spanning Abhay's core patterns, prompts re-written in
 * our own words. Hidden tests + graduated hints live ONLY here on the server —
 * they are stripped from every public `InterviewProblem` response so a candidate
 * can never read the answer key or the ladder ahead of time.
 */

/** Order-insensitive normalization applied to BOTH actual and expected. */
export type Normalize = "sortInner" | "sortOuter" | null;

export interface HiddenTest {
  name: string;
  /** Positional arguments spread into the candidate's function. JSON-only. */
  args: unknown[];
  expected: unknown;
  normalize?: Normalize;
}

export interface BankProblem extends InterviewProblem {
  tests: HiddenTest[];
  /** [recognition signal, approach shape, key insight] — never full code. */
  hints: [string, string, string];
}

/* --------------------------- generator helpers --------------------------- */

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const fill = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

/* ------------------------------- the bank -------------------------------- */

export const PROBLEMS: BankProblem[] = [
  {
    id: "two-sum",
    lcNumber: 1,
    title: "Two Sum",
    difficulty: "easy",
    pattern: "arrays-and-hashing",
    tags: ["array", "hash-map"],
    functionName: "twoSum",
    promptMd: [
      "Given an array of integers `nums` and an integer `target`, return the **indices** of the two numbers that add up to `target`.",
      "",
      "Each input has **exactly one** solution, and you may not reuse the same element twice. The answer may be returned in any order.",
      "",
      "**Constraints**",
      "- `2 <= nums.length <= 10^4`",
      "- `-10^9 <= nums[i] <= 10^9`",
      "- Exactly one valid pair exists.",
      "",
      "**Examples**",
      "```",
      "twoSum([2,7,11,15], 9)  -> [0,1]   (nums[0] + nums[1] == 9)",
      "twoSum([3,2,4], 6)      -> [1,2]   (nums[1] + nums[2] == 6)",
      "twoSum([3,3], 6)        -> [0,1]",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def twoSum(nums, target):\n    \"\"\"Return the indices of the two numbers adding to target.\"\"\"\n    pass\n",
      javascript: "function twoSum(nums, target) {\n  // your code here\n}\n",
    },
    hints: [
      "You are searching for a complement (target - current) as you scan. Notice you keep asking 'have I seen the number that completes this one?'",
      "A hash map from value -> index turns that lookup into O(1). This is the arrays-and-hashing pattern.",
      "Store each number's index as you go and check for target - nums[i] BEFORE inserting the current one, so a single pass suffices.",
    ],
    tests: [
      { name: "example 1", args: [[2, 7, 11, 15], 9], expected: [0, 1], normalize: "sortInner" },
      { name: "example 2", args: [[3, 2, 4], 6], expected: [1, 2], normalize: "sortInner" },
      { name: "duplicate values", args: [[3, 3], 6], expected: [0, 1], normalize: "sortInner" },
      { name: "two elements", args: [[1, 2], 3], expected: [0, 1], normalize: "sortInner" },
      { name: "all negatives", args: [[-1, -2, -3, -4, -5], -8], expected: [2, 4], normalize: "sortInner" },
      { name: "zeros", args: [[0, 4, 3, 0], 0], expected: [0, 3], normalize: "sortInner" },
      { name: "mixed sign", args: [[-3, 4, 3, 90], 0], expected: [0, 2], normalize: "sortInner" },
      { name: "pair mid-array", args: [[1, 5, 8, 3, 9, 2], 11], expected: [2, 3], normalize: "sortInner" },
      { name: "repeated addend", args: [[2, 5, 5, 11], 10], expected: [1, 2], normalize: "sortInner" },
      { name: "perf: 10k ascending", args: [range(10000), 19997], expected: [9998, 9999], normalize: "sortInner" },
    ],
  },
  {
    id: "valid-parentheses",
    lcNumber: 20,
    title: "Valid Parentheses",
    difficulty: "easy",
    pattern: "stack",
    tags: ["string", "stack"],
    functionName: "isValid",
    promptMd: [
      "Given a string `s` containing only the characters `()[]{}`, decide whether the brackets are **validly nested**.",
      "",
      "A string is valid when every opening bracket is closed by the matching type, in the correct order, and nothing is left open.",
      "",
      "**Constraints**",
      "- `0 <= s.length <= 10^4`",
      "- `s` consists only of `()[]{}`.",
      "",
      "**Examples**",
      "```",
      "isValid(\"()[]{}\") -> true",
      "isValid(\"(]\")     -> false",
      "isValid(\"([)]\")   -> false",
      "isValid(\"\")       -> true    (nothing to close)",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def isValid(s):\n    \"\"\"Return True if the brackets in s are validly nested.\"\"\"\n    pass\n",
      javascript: "function isValid(s) {\n  // your code here\n}\n",
    },
    hints: [
      "Order matters and the most recent unmatched opener is the first that must close — that 'last in, first out' shape is the signal.",
      "Use a stack: push openers, and on a closer check the top of the stack.",
      "A closer is only valid if the stack is non-empty and its top is the matching opener; at the end the stack must be empty.",
    ],
    tests: [
      { name: "simple pair", args: ["()"], expected: true },
      { name: "all three types", args: ["()[]{}"], expected: true },
      { name: "mismatched close", args: ["(]"], expected: false },
      { name: "wrong order", args: ["([)]"], expected: false },
      { name: "nested valid", args: ["{[]}"], expected: true },
      { name: "empty string", args: [""], expected: true },
      { name: "single opener", args: ["("], expected: false },
      { name: "single closer", args: ["]"], expected: false },
      { name: "deep nest", args: ["((()))"], expected: true },
      { name: "unclosed run", args: ["((("], expected: false },
      { name: "close before open", args: ["){"], expected: false },
      { name: "perf: 5k pairs", args: ["()".repeat(5000)], expected: true },
    ],
  },
  {
    id: "best-time-buy-sell-stock",
    lcNumber: 121,
    title: "Best Time to Buy and Sell Stock",
    difficulty: "easy",
    pattern: "greedy",
    tags: ["array", "greedy"],
    functionName: "maxProfit",
    promptMd: [
      "You are given `prices`, where `prices[i]` is the price of a stock on day `i`. You may buy on one day and sell on a **later** day, at most once.",
      "",
      "Return the maximum profit achievable, or `0` if no profitable trade exists.",
      "",
      "**Constraints**",
      "- `0 <= prices.length <= 10^5`",
      "- `0 <= prices[i] <= 10^4`",
      "",
      "**Examples**",
      "```",
      "maxProfit([7,1,5,3,6,4]) -> 5   (buy at 1, sell at 6)",
      "maxProfit([7,6,4,3,1])   -> 0   (only losses)",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def maxProfit(prices):\n    \"\"\"Return the max single-transaction profit.\"\"\"\n    pass\n",
      javascript: "function maxProfit(prices) {\n  // your code here\n}\n",
    },
    hints: [
      "For each day you only care about the cheapest price seen so far to its left — that running minimum is the signal.",
      "Sweep once, tracking the minimum price so far and the best profit if you sold today. Greedy, single pass.",
      "profit_today = price - min_so_far; update the answer and the running minimum on every step.",
    ],
    tests: [
      { name: "classic", args: [[7, 1, 5, 3, 6, 4]], expected: 5 },
      { name: "monotone decreasing", args: [[7, 6, 4, 3, 1]], expected: 0 },
      { name: "empty", args: [[]], expected: 0 },
      { name: "single day", args: [[1]], expected: 0 },
      { name: "two ascending", args: [[1, 2]], expected: 1 },
      { name: "two descending", args: [[2, 1]], expected: 0 },
      { name: "all equal", args: [[3, 3, 3]], expected: 0 },
      { name: "monotone increasing", args: [[1, 2, 3, 4, 5]], expected: 4 },
      { name: "dip then peak", args: [[3, 2, 6, 5, 0, 3]], expected: 4 },
      { name: "peak before dip", args: [[2, 4, 1]], expected: 2 },
      { name: "perf: 10k ascending", args: [range(10000)], expected: 9999 },
    ],
  },
  {
    id: "longest-substring-without-repeating",
    lcNumber: 3,
    title: "Longest Substring Without Repeating Characters",
    difficulty: "medium",
    pattern: "sliding-window",
    tags: ["string", "sliding-window", "hash-map"],
    functionName: "lengthOfLongestSubstring",
    promptMd: [
      "Given a string `s`, return the length of the **longest substring** that contains no repeated character.",
      "",
      "A substring is a contiguous run of characters.",
      "",
      "**Constraints**",
      "- `0 <= s.length <= 5 * 10^4`",
      "- `s` may contain letters, digits, symbols, and spaces.",
      "",
      "**Examples**",
      "```",
      "lengthOfLongestSubstring(\"abcabcbb\") -> 3   (\"abc\")",
      "lengthOfLongestSubstring(\"bbbbb\")    -> 1   (\"b\")",
      "lengthOfLongestSubstring(\"pwwkew\")   -> 3   (\"wke\")",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def lengthOfLongestSubstring(s):\n    \"\"\"Return the length of the longest repeat-free substring.\"\"\"\n    pass\n",
      javascript: "function lengthOfLongestSubstring(s) {\n  // your code here\n}\n",
    },
    hints: [
      "You are looking at a contiguous window and only ever need to grow the right edge or shrink the left edge — never restart from scratch.",
      "Sliding window with a set (or last-seen-index map) of the characters currently inside the window.",
      "When the new character is already in the window, advance the left edge past its previous occurrence instead of stepping one at a time.",
    ],
    tests: [
      { name: "abcabcbb", args: ["abcabcbb"], expected: 3 },
      { name: "all same", args: ["bbbbb"], expected: 1 },
      { name: "pwwkew", args: ["pwwkew"], expected: 3 },
      { name: "empty", args: [""], expected: 0 },
      { name: "single char", args: ["a"], expected: 1 },
      { name: "two distinct", args: ["au"], expected: 2 },
      { name: "dvdf", args: ["dvdf"], expected: 3 },
      { name: "abba", args: ["abba"], expected: 2 },
      { name: "single space", args: [" "], expected: 1 },
      { name: "tmmzuxt", args: ["tmmzuxt"], expected: 5 },
      { name: "perf: 10k cycle", args: ["abcdefghij".repeat(1000)], expected: 10 },
    ],
  },
  {
    id: "search-rotated-sorted-array",
    lcNumber: 33,
    title: "Search in Rotated Sorted Array",
    difficulty: "medium",
    pattern: "binary-search",
    tags: ["array", "binary-search"],
    functionName: "search",
    promptMd: [
      "An ascending array of **distinct** integers was rotated at some unknown pivot (e.g. `[0,1,2,4,5,6,7]` becomes `[4,5,6,7,0,1,2]`).",
      "",
      "Given the rotated array `nums` and a `target`, return the index of `target`, or `-1` if it is absent. Aim for `O(log n)`.",
      "",
      "**Constraints**",
      "- `1 <= nums.length <= 5000`",
      "- All values are distinct.",
      "- `nums` is a rotation of an ascending array.",
      "",
      "**Examples**",
      "```",
      "search([4,5,6,7,0,1,2], 0) -> 4",
      "search([4,5,6,7,0,1,2], 3) -> -1",
      "search([1], 0)             -> -1",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def search(nums, target):\n    \"\"\"Return the index of target in the rotated array, or -1.\"\"\"\n    pass\n",
      javascript: "function search(nums, target) {\n  // your code here\n}\n",
    },
    hints: [
      "The array is sorted, just cut once — the O(log n) requirement rules out a linear scan. That points at binary search.",
      "At any midpoint, one of the two halves is still fully sorted. Identify which half is sorted first.",
      "If the target lies within the sorted half's range, recurse there; otherwise recurse into the other half.",
    ],
    tests: [
      { name: "target in rotated tail", args: [[4, 5, 6, 7, 0, 1, 2], 0], expected: 4 },
      { name: "absent", args: [[4, 5, 6, 7, 0, 1, 2], 3], expected: -1 },
      { name: "single miss", args: [[1], 0], expected: -1 },
      { name: "single hit", args: [[1], 1], expected: 0 },
      { name: "pivot at front", args: [[5, 1, 3], 5], expected: 0 },
      { name: "two elements hit", args: [[1, 3], 3], expected: 1 },
      { name: "rotated two", args: [[3, 1], 1], expected: 1 },
      { name: "target in sorted head", args: [[4, 5, 6, 7, 8, 1, 2, 3], 8], expected: 4 },
      { name: "absent in rotated", args: [[6, 7, 0, 1, 2, 4, 5], 3], expected: -1 },
      { name: "not rotated", args: [[1, 2, 3, 4, 5, 6], 4], expected: 3 },
      { name: "perf: 10k not rotated", args: [range(10000), 7777], expected: 7777 },
    ],
  },
  {
    id: "maximum-subarray",
    lcNumber: 53,
    title: "Maximum Subarray",
    difficulty: "medium",
    pattern: "dp-1d",
    tags: ["array", "dynamic-programming"],
    functionName: "maxSubArray",
    promptMd: [
      "Given an integer array `nums`, find the contiguous subarray (containing at least one number) with the **largest sum**, and return that sum.",
      "",
      "**Constraints**",
      "- `1 <= nums.length <= 10^5`",
      "- `-10^4 <= nums[i] <= 10^4`",
      "",
      "**Examples**",
      "```",
      "maxSubArray([-2,1,-3,4,-1,2,1,-5,4]) -> 6   ([4,-1,2,1])",
      "maxSubArray([1])                     -> 1",
      "maxSubArray([5,4,-1,7,8])            -> 23",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def maxSubArray(nums):\n    \"\"\"Return the largest sum of any contiguous subarray.\"\"\"\n    pass\n",
      javascript: "function maxSubArray(nums) {\n  // your code here\n}\n",
    },
    hints: [
      "At each index ask: does the best subarray ending here extend the previous one, or start fresh at me? That local choice is the signal.",
      "1-D dynamic programming (Kadane): carry the best sum ending at the current index.",
      "best_ending_here = max(nums[i], best_ending_here + nums[i]); the answer is the max over all i. A negative running sum should be dropped.",
    ],
    tests: [
      { name: "classic", args: [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], expected: 6 },
      { name: "single positive", args: [[1]], expected: 1 },
      { name: "mostly positive", args: [[5, 4, -1, 7, 8]], expected: 23 },
      { name: "single negative", args: [[-1]], expected: -1 },
      { name: "two negatives", args: [[-2, -1]], expected: -1 },
      { name: "all negative", args: [[-3, -2, -5]], expected: -2 },
      { name: "all positive", args: [[1, 2, 3, 4]], expected: 10 },
      { name: "tail dominates", args: [[-1, -2, -3, 4]], expected: 4 },
      { name: "recover from dip", args: [[8, -19, 5, -4, 20]], expected: 21 },
      { name: "all zeros", args: [[0, 0, 0]], expected: 0 },
      { name: "perf: 10k ones", args: [fill(10000, 1)], expected: 10000 },
    ],
  },
  {
    id: "merge-intervals",
    lcNumber: 56,
    title: "Merge Intervals",
    difficulty: "medium",
    pattern: "intervals",
    tags: ["array", "sorting", "intervals"],
    functionName: "merge",
    promptMd: [
      "Given a list of `intervals` where `intervals[i] = [start, end]`, merge every set of overlapping intervals and return the resulting non-overlapping intervals.",
      "",
      "Two intervals overlap when one starts at or before the other ends (touching endpoints count as overlapping).",
      "",
      "**Constraints**",
      "- `1 <= intervals.length <= 10^4`",
      "- `intervals[i].length == 2` and `start <= end`.",
      "",
      "**Examples**",
      "```",
      "merge([[1,3],[2,6],[8,10],[15,18]]) -> [[1,6],[8,10],[15,18]]",
      "merge([[1,4],[4,5]])                -> [[1,5]]   (touching endpoints merge)",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def merge(intervals):\n    \"\"\"Merge overlapping intervals and return the result.\"\"\"\n    pass\n",
      javascript: "function merge(intervals) {\n  // your code here\n}\n",
    },
    hints: [
      "Overlap is only ever between neighbours once the intervals are lined up by start — that ordering is the signal.",
      "Sort by start, then sweep once merging into the last interval in your output.",
      "Merge when the current start <= the last output's end, extending that end to max(prev_end, cur_end); otherwise append a new interval.",
    ],
    tests: [
      { name: "classic", args: [[[1, 3], [2, 6], [8, 10], [15, 18]]], expected: [[1, 6], [8, 10], [15, 18]], normalize: "sortOuter" },
      { name: "touching endpoints", args: [[[1, 4], [4, 5]]], expected: [[1, 5]], normalize: "sortOuter" },
      { name: "single interval", args: [[[1, 4]]], expected: [[1, 4]], normalize: "sortOuter" },
      { name: "fully contained", args: [[[1, 4], [2, 3]]], expected: [[1, 4]], normalize: "sortOuter" },
      { name: "no overlap", args: [[[1, 4], [5, 6]]], expected: [[1, 4], [5, 6]], normalize: "sortOuter" },
      { name: "unsorted input", args: [[[2, 3], [1, 5]]], expected: [[1, 5]], normalize: "sortOuter" },
      { name: "shared start", args: [[[1, 4], [0, 4]]], expected: [[0, 4]], normalize: "sortOuter" },
      { name: "zero-width apart", args: [[[1, 4], [0, 0]]], expected: [[0, 0], [1, 4]], normalize: "sortOuter" },
      { name: "one swallows all", args: [[[1, 10], [2, 3], [4, 5], [6, 7]]], expected: [[1, 10]], normalize: "sortOuter" },
      { name: "perf: 5k disjoint", args: [range(5000).map((i) => [i * 2, i * 2 + 1])], expected: range(5000).map((i) => [i * 2, i * 2 + 1]), normalize: "sortOuter" },
    ],
  },
  {
    id: "number-of-islands",
    lcNumber: 200,
    title: "Number of Islands",
    difficulty: "medium",
    pattern: "graphs",
    tags: ["matrix", "dfs", "bfs", "union-find"],
    functionName: "numIslands",
    promptMd: [
      "Given a 2-D `grid` of `'1'` (land) and `'0'` (water), count the number of islands. An island is a maximal group of land cells connected **4-directionally** (up/down/left/right).",
      "",
      "The grid's outside edges are all water.",
      "",
      "**Constraints**",
      "- `0 <= rows, cols <= 300`",
      "- Each cell is the string `'0'` or `'1'`.",
      "",
      "**Examples**",
      "```",
      "numIslands([[\"1\",\"1\",\"0\"],",
      "            [\"1\",\"0\",\"0\"],",
      "            [\"0\",\"0\",\"1\"]]) -> 2",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def numIslands(grid):\n    \"\"\"Count 4-directionally connected islands of '1'.\"\"\"\n    pass\n",
      javascript: "function numIslands(grid) {\n  // your code here\n}\n",
    },
    hints: [
      "Each land cell belongs to exactly one connected region — you are counting connected components, which is the graph signal.",
      "Scan every cell; when you hit an unvisited '1', flood-fill (DFS/BFS) its whole region and count one island.",
      "Mark cells visited as you flood (flip to '0' or use a seen-set) so each region is counted exactly once.",
    ],
    tests: [
      { name: "two islands", args: [[["1", "1", "0"], ["1", "0", "0"], ["0", "0", "1"]]], expected: 2 },
      { name: "one big island", args: [[["1", "1", "1", "1", "0"], ["1", "1", "0", "1", "0"], ["1", "1", "0", "0", "0"], ["0", "0", "0", "0", "0"]]], expected: 1 },
      { name: "three islands", args: [[["1", "1", "0", "0", "0"], ["1", "1", "0", "0", "0"], ["0", "0", "1", "0", "0"], ["0", "0", "0", "1", "1"]]], expected: 3 },
      { name: "single water", args: [[["0"]]], expected: 0 },
      { name: "single land", args: [[["1"]]], expected: 1 },
      { name: "empty grid", args: [[]], expected: 0 },
      { name: "all water", args: [[["0", "0"], ["0", "0"]]], expected: 0 },
      { name: "single row checkerboard", args: [[["1", "0", "1", "0", "1"]]], expected: 3 },
      { name: "single column split", args: [[["1"], ["0"], ["1"]]], expected: 2 },
      { name: "perf: 100x100 striped", args: [range(100).map(() => range(100).map((c) => (c % 2 === 0 ? "1" : "0")))], expected: 50 },
    ],
  },
  {
    id: "coin-change",
    lcNumber: 322,
    title: "Coin Change",
    difficulty: "medium",
    pattern: "dp-1d",
    tags: ["dynamic-programming", "bfs"],
    functionName: "coinChange",
    promptMd: [
      "You have coins of the denominations in `coins` (unlimited supply of each) and a target `amount`. Return the **fewest** coins needed to make exactly `amount`, or `-1` if it cannot be made.",
      "",
      "**Constraints**",
      "- `1 <= coins.length <= 12`",
      "- `1 <= coins[i] <= 2^31 - 1`",
      "- `0 <= amount <= 10^4`",
      "",
      "**Examples**",
      "```",
      "coinChange([1,2,5], 11) -> 3   (5 + 5 + 1)",
      "coinChange([2], 3)      -> -1",
      "coinChange([1], 0)      -> 0",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def coinChange(coins, amount):\n    \"\"\"Return the fewest coins summing to amount, or -1.\"\"\"\n    pass\n",
      javascript: "function coinChange(coins, amount) {\n  // your code here\n}\n",
    },
    hints: [
      "Greedy (always take the biggest coin) fails on denominations like [1,3,4]. The best answer for `amount` builds on the best answers for smaller amounts — that overlap is the signal.",
      "1-D DP: dp[a] = fewest coins to make amount a, built from 0 up to amount.",
      "dp[a] = min over each coin c <= a of dp[a - c] + 1; seed dp[0] = 0 and treat unreachable amounts as infinity, returning -1 if the target stays unreachable.",
    ],
    tests: [
      { name: "classic", args: [[1, 2, 5], 11], expected: 3 },
      { name: "impossible", args: [[2], 3], expected: -1 },
      { name: "zero amount", args: [[1], 0], expected: 0 },
      { name: "only ones", args: [[1], 2], expected: 2 },
      { name: "zero with many coins", args: [[1, 2, 5], 0], expected: 0 },
      { name: "unordered coins", args: [[2, 5, 10, 1], 27], expected: 4 },
      { name: "hard denominations", args: [[186, 419, 83, 408], 6249], expected: 20 },
      { name: "coprime miss", args: [[3, 7], 5], expected: -1 },
      { name: "greedy trap", args: [[1, 5, 10, 25], 30], expected: 2 },
      { name: "perf: large amount", args: [[1, 2, 5], 9999], expected: 2001 },
    ],
  },
  {
    id: "trapping-rain-water",
    lcNumber: 42,
    title: "Trapping Rain Water",
    difficulty: "hard",
    pattern: "two-pointers",
    tags: ["array", "two-pointers", "stack", "dynamic-programming"],
    functionName: "trap",
    promptMd: [
      "Given `height`, a list of non-negative bar heights each of width 1, compute how many units of water are trapped after raining.",
      "",
      "Water above bar `i` is bounded by the tallest bar to its left and the tallest bar to its right.",
      "",
      "**Constraints**",
      "- `0 <= height.length <= 2 * 10^4`",
      "- `0 <= height[i] <= 10^5`",
      "",
      "**Examples**",
      "```",
      "trap([0,1,0,2,1,0,1,3,2,1,2,1]) -> 6",
      "trap([4,2,0,3,2,5])             -> 9",
      "```",
    ].join("\n"),
    starterCode: {
      python: "def trap(height):\n    \"\"\"Return the total trapped rain water.\"\"\"\n    pass\n",
      javascript: "function trap(height) {\n  // your code here\n}\n",
    },
    hints: [
      "Water over a bar depends only on min(tallest-left, tallest-right) minus its own height — each position is capped by walls on both sides.",
      "Two pointers from both ends, tracking the running max height on each side; the smaller side is the binding constraint, so advance it.",
      "Move whichever pointer has the smaller wall; the water it adds is (its running-max on that side) - (its own height), because the other side is guaranteed at least as tall.",
    ],
    tests: [
      { name: "classic", args: [[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]], expected: 6 },
      { name: "deep well", args: [[4, 2, 0, 3, 2, 5]], expected: 9 },
      { name: "empty", args: [[]], expected: 0 },
      { name: "single bar", args: [[1]], expected: 0 },
      { name: "two bars", args: [[1, 2]], expected: 0 },
      { name: "simple basin", args: [[3, 0, 3]], expected: 3 },
      { name: "flat", args: [[5, 5, 5]], expected: 0 },
      { name: "small dip", args: [[2, 0, 2]], expected: 2 },
      { name: "slope no trap", args: [[4, 2, 3]], expected: 1 },
      { name: "all zero", args: [[0, 0, 0]], expected: 0 },
      { name: "perf: wide basin", args: [[5000, ...fill(9998, 0), 5000]], expected: 49990000 },
    ],
  },
];

/* ------------------------------- lookups --------------------------------- */

const BY_ID = new Map<string, BankProblem>(PROBLEMS.map((p) => [p.id, p]));

export function getBankProblem(id: string): BankProblem | undefined {
  return BY_ID.get(id);
}

/** Strip hidden tests + hints; the public shape a candidate is allowed to see. */
export function toPublicProblem(p: BankProblem): InterviewProblem {
  const starterCode: Record<InterviewLanguage, string> = {
    python: p.starterCode.python,
    javascript: p.starterCode.javascript,
  };
  const meta: InterviewProblem = {
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    pattern: p.pattern,
    tags: [...p.tags],
    promptMd: p.promptMd,
    functionName: p.functionName,
    starterCode,
  };
  if (p.lcNumber !== undefined) meta.lcNumber = p.lcNumber;
  if (p.custom) meta.custom = true;
  return meta;
}

export function toMeta(p: BankProblem): InterviewProblemMeta {
  const meta: InterviewProblemMeta = {
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    pattern: p.pattern,
    tags: [...p.tags],
  };
  if (p.lcNumber !== undefined) meta.lcNumber = p.lcNumber;
  if (p.custom) meta.custom = true;
  return meta;
}
