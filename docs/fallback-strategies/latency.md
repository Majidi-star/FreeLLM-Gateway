# Fastest (Latency-Based) Strategy

**Strategy ID:** `latency`

The **Fastest (Latency-Based)** strategy dynamically routes requests based on real-world performance data. It learns which providers are currently responding the fastest and prioritizes them automatically, functioning as a passive self-healing system.

## How it works

1. **Measurement:** Every time a request passes through FreeLLM-Gateway (regardless of what strategy triggered it), the router silently times the duration. For streaming requests, this measures the Time To First Token (TTFT). For standard requests, it measures the full round-trip duration.
2. **Historical Tracking:** The gateway maintains a persistent Exponential Moving Average (EMA) of latency in milliseconds for every unique provider/model combination. New requests account for 20% of the moving average, while historical data accounts for 80%. This ensures the average isn't easily skewed by a single anomalous request, but still quickly adapts if a provider suffers an outage.
3. **Queue Sorting:** When a request is made against a virtual pool configured with the `latency` strategy, the gateway looks up the historical `avgLatency` for all available targets. It then sorts the queue in ascending order (lowest latency / fastest goes first).
4. **Fallback:** If the fastest provider fails or hits a rate limit, the gateway falls back to the *second* fastest provider, and so on.

*Note: New provider combinations with no historical data are given a default assumed latency of 1000ms until they are successfully used.*

## Best Used For

* **Production Speed:** When minimizing response delay or Time To First Token is the absolute highest priority. 
* **Dynamic Network Conditions:** When using unreliable or geographically distributed free tier APIs where ping times and processing times fluctuate drastically depending on the time of day or provider load. 

## Technical Advantages
Unlike active-probing systems (which send dummy "ping" payloads to providers to measure speed), FreeLLM-Gateway uses *Passive Historical Tracking*. This ensures:
* **Zero Wasted Quotas:** The system never burns through your valuable free-tier rate limits just to check if a model is fast. It strictly learns from organic user traffic.
* **Zero Added Overhead:** Sorting the queue relies entirely on local in-memory metrics, adding sub-millisecond execution time before firing the request.
