export const SAMPLE_SOURCE = `# Write Python-like pseudocode on the left.
# The control-flow graph on the right updates as you type,
# and keeps the nodes you have moved where you put them.

def find_index(items, target):
    i = 0
    while i < len(items):
        if items[i] == target:
            return i
        elif items[i] is None:
            break
        i = i + 1
    return -1
`;

export type Example = { name: string; source: string };

/** Starting points offered in the editor's Examples menu. */
export const EXAMPLES: Example[] = [
  { name: "Linear search", source: SAMPLE_SOURCE },
  {
    name: "Binary search",
    source: `def binary_search(items, target):
    lo, hi = 0, len(items) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if items[mid] == target:
            return mid
        elif items[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
`,
  },
  {
    name: "for / else with break and continue",
    source: `for x in xs:
    if x is None:
        continue
    if x < 0:
        print("negative", x)
        break
    total = total + x
else:
    print("all non-negative")
print(total)
`,
  },
  {
    name: "Several functions",
    source: `def is_prime(n):
    if n < 2:
        return False
    for d in range(2, n):
        if n % d == 0:
            return False
    return True

def first_prime_after(n):
    n = n + 1
    while not is_prime(n):
        n = n + 1
    return n

print(first_prime_after(100))
`,
  },
  {
    name: "Retry with errors",
    source: `attempts = 0
while True:
    attempts = attempts + 1
    response = fetch(url)
    if response.ok:
        break
    if attempts >= 3:
        raise TimeoutError("gave up")
    sleep(2 ** attempts)
handle(response)
`,
  },
];
