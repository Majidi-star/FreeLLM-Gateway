# Fallback Strategies in FreeLLM-Gateway

FreeLLM-Gateway implements robust, self-healing virtual pools (Combos) to abstract away the unreliability of free-tier LLM API endpoints. When a user requests a virtual model (e.g., `coding-agent`), the gateway intercepts the request and selects a backend provider from a pool of eligible models.

If a backend provider returns an error (like a 429 Rate Limit or 5xx Server Error), the Gateway catches it, places the provider on a temporary cooldown, and transparently attempts the request against the next best provider in the queue without throwing an error to the end-user.

### Available Selection Strategies
The order in which the pool's models are attempted is dictated by the **Strategy** applied to the Virtual Pool. 

1. **[Priority Failover](./priority.md):** Attempts models strictly in the order they were added to the pool.
2. **[Load Balanced (Random)](./random.md):** Shuffles the pool targets randomly on each request to distribute load evenly across providers.
3. **[Fastest (Latency-Based)](./latency.md):** Dynamically sorts the queue by tracking historical latency, always prioritizing the provider that historically responds the fastest.

To configure a strategy, open the FreeLLM-Gateway dashboard, navigate to **Active Pools**, and change the *Routing Strategy* dropdown on any configured virtual model.
