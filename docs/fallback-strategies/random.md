# Load Balanced (Random) Strategy

**Strategy ID:** `random`

The **Load Balanced (Random)** strategy is designed to evenly distribute incoming traffic across multiple providers to prevent any single provider from being quickly rate-limited.

## How it works

1. **Shuffle:** When a request is made, the gateway takes the full list of target providers in the virtual pool and completely randomizes (shuffles) their order.
2. **Attempt:** It then selects the first provider from this newly randomized list.
3. **Success:** If the request succeeds, it returns the data to the user.
4. **Fallback:** If the request fails, the gateway will fall back to the next provider in the *randomized* queue, continuing until a success is achieved or the queue is exhausted.

## Best Used For

* **Strict Rate Limit Environments:** Free-tier APIs often restrict users by 'Requests Per Minute' (RPM). If you have three identical free providers that allow 10 RPM each, using a Priority strategy would mean the top provider always gets hit and instantly exhausts its 10 RPM, causing delay while the gateway falls back. The Random strategy distributes the requests, allowing you to seamlessly achieve a combined 30 RPM without constantly triggering failover logic.
* **Redundant Pools:** When you have a pool entirely made up of identical or equally capable models (e.g. four different providers all offering `llama-3.1-8b-instruct`), and you do not prefer one over the other.

## Technical Detail
* The random sort operates on a standard `Math.random() - 0.5` JavaScript distribution. Over thousands of requests, traffic perfectly splits `(1 / N)` across `N` targets.
