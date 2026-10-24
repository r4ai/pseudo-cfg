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
