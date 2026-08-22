# Priority Failover Strategy

**Strategy ID:** `priority`

The **Priority Failover** strategy is a deterministic routing method. It strictly attempts the backend models exactly in the order they are listed in your Active Pools configuration.

## How it works

1. **Top-Down Attempt:** When a request is made, the gateway selects the very first provider/model in the target list (index 0).
2. **Success:** If the provider responds successfully, the result is returned to the user, and the gateway does not touch any other providers.
3. **Failure / Rate Limit:** If the first provider hits a rate limit (429) or another actionable error (like 502/503), the gateway places that specific provider on a cooldown.
4. **Fallback:** The gateway instantly falls back to the second provider in the list (index 1). This process repeats continuously down the list until one succeeds.
5. **Exhaustion:** Only if *every* provider in the target list fails or is currently on cooldown will the gateway finally return a failure to the end user.

## Best Used For

* **Cost Optimization:** When you mix premium (paid) APIs with free APIs in the same pool. You can place all your free API endpoints at the top of the list, and your paid API key at the absolute bottom as a safety net. The gateway will always exhaust the free options before spending your money.
* **Preferred Capability:** When you heavily prefer the output of one specific model (e.g. `gpt-4o`) but want to fallback to a slightly worse model (e.g. `claude-3-5-haiku`) if the first one goes down.

## Configuration Details
* You can reorder the priority queue simply by adding the targets in your desired sequence in the Active Pools UI.
* This is the default strategy applied to all new Virtual Models.
