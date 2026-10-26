import type { Language } from "@/features/cfg/build-cfg";

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

const CUDA_SAMPLE_SOURCE = `// Write CUDA- or C-like pseudocode on the left.
// Each function becomes its own control-flow graph.

__global__ void scale(int n, float a, const float *x, float *y) {
    for (int i = blockIdx.x * blockDim.x + threadIdx.x; i < n; i += blockDim.x * gridDim.x) {
        if (isnan(x[i])) {
            continue;
        } else if (x[i] < 0) {
            y[i] = 0;
        } else {
            y[i] = a * x[i];
        }
    }
}
`;

export type Example = { name: string; language: Language; source: string };

/** Starting points offered in the editor's Examples menu. */
export const EXAMPLES: Example[] = [
  { name: "Linear search", language: "python", source: SAMPLE_SOURCE },
  {
    name: "Binary search",
    language: "python",
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
    language: "python",
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
    language: "python",
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
    language: "python",
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
  { name: "Grid-stride kernel", language: "cuda", source: CUDA_SAMPLE_SOURCE },
  {
    name: "Shared-memory reduction",
    language: "cuda",
    source: `__global__ void reduce_sum(const float *in, float *out, int n) {
    extern __shared__ float cache[];
    int tid = threadIdx.x;
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    cache[tid] = i < n ? in[i] : 0.0f;
    __syncthreads();
    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (tid < s) {
            cache[tid] += cache[tid + s];
        }
        __syncthreads();
    }
    if (tid == 0) {
        atomicAdd(out, cache[0]);
    }
}
`,
  },
  {
    name: "Host code with switch and do / while",
    language: "cuda",
    source: `int main(int argc, char **argv) {
    float *d_x;
    cudaError_t err = cudaMalloc(&d_x, N * sizeof(float));
    if (err != cudaSuccess) {
        fprintf(stderr, "%s\\n", cudaGetErrorString(err));
        return 1;
    }
    switch (mode) {
    case MODE_FAST:
        launch_fast<<<blocks, 256>>>(d_x, N);
        break;
    case MODE_SAFE:
        check_inputs(d_x, N);
    default:
        launch_safe<<<blocks, 128>>>(d_x, N);
    }
    int tries = 0;
    do {
        err = cudaDeviceSynchronize();
        tries++;
    } while (err == cudaErrorNotReady && tries < 3);
    cudaFree(d_x);
    return 0;
}
`,
  },
];

/** The example a new workspace, or one switched to `language`, starts from. */
export const sampleFor = (language: Language) => EXAMPLES.find((e) => e.language === language) as Example;
