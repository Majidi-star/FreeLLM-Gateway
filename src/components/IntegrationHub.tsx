import React, { useState } from 'react';
import type { GatewayConfig } from '../utils/api';

interface IntegrationGuide {
  id: string;
  name: string;
  icon: string;
  description: string;
  instructions: string;
  code: string;
  language: string;
}

interface IntegrationHubProps {
  config?: GatewayConfig;
}

export const IntegrationHub: React.FC<IntegrationHubProps> = ({ config }) => {
  const [activeGuide, setActiveGuide] = useState<string>('cursor');
  const [copied, setCopied] = useState(false);

  const serverPort = config?.metadata?.port || 3000;
  const currentHost = window.location.hostname || 'localhost';
  const gatewayUrl = `${window.location.protocol}//${currentHost}:${serverPort}/v1`;
  const mcpPath = config?.metadata?.mcpPath || 'C:/Projects/Free-LLM-Provider/server/mcp.js';

  const virtualKeys = config?.virtualKeys || [];
  const hasVirtualKeys = virtualKeys.length > 0;
  const exampleKey = hasVirtualKeys ? (virtualKeys[0]?.id || 'any-key') : 'any-key';
  const keyWarning = hasVirtualKeys 
    ? `\n\n⚠️ IMPORTANT: Active Virtual Gateway Keys are configured in your dashboard. You MUST enter one of your active keys (e.g., "${exampleKey}") in the OpenAI API Key field for authentication.`
    : `\n\nℹ️ Note: No virtual keys are configured, so you can enter any mock string (e.g., "any-key") in the API Key field.`;

  const guides: IntegrationGuide[] = [
    {
      id: 'cursor',
      name: 'Cursor AI Editor',
      icon: '💻',
      description: 'Configure Cursor to use the gateway pools for inline coding and chat.',
      instructions: `1. Open Cursor Settings (gear icon in the top right of the editor).
2. Navigate to the "Models" section.
3. Find the "OpenAI" section, toggle it ON, and click "Configure" (or "Override OpenAI Base URL" depending on Cursor version).
4. Enter the gateway URL in the "Override OpenAI Base URL" field:
   ${gatewayUrl}
5. Enter your gateway API key (e.g. "${exampleKey}") in the "OpenAI API Key" field.${keyWarning}
6. Under the model list, click "+ Add Model" to register our virtual gateway pools:
   - strong-reasoning
   - coding-agent
   - fast-flash
7. Toggle off default OpenAI models (like gpt-4o) if you only want traffic to flow to your free pools, reload Cursor, and start coding!`,
      code: '',
      language: 'text'
    },
    {
      id: 'mcp',
      name: 'Model Context Protocol (MCP)',
      icon: '🔌',
      description: 'Register the Free LLM Gateway as an MCP server in Cursor or Claude Desktop.',
      instructions: `The gateway includes a built-in stdio-transport MCP server at server/mcp.js. This exposes gateway status, providers listing, dynamic model sync, and virtual pool completions as MCP tools.

To configure Claude Desktop:
1. Locate your claude_desktop_config.json file:
   - Windows: %APPDATA%\\Claude\\claude_desktop_config.json
   - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
2. Open the file and add the config JSON below under the "mcpServers" key.

To configure Cursor:
1. Open Cursor Settings -> Features -> MCP.
2. Click "+ Add New MCP Server".
3. Enter Name: Free LLM Gateway, Type: stdio.
4. Input Command: node ${mcpPath}
5. Save, restart, and let the AI models call pool completions automatically!`,
      code: `{
  "mcpServers": {
    "free-llm-gateway": {
      "command": "node",
      "args": ["${mcpPath}"]
    }
  }
}`,
      language: 'json'
    },
    {
      id: 'aider',
      name: 'Aider CLI Developer',
      icon: '🤖',
      description: 'Run the Aider coding agent using the pooled free models.',
      instructions: `To run Aider with our pooled coding model:
1. Open your terminal in your repository.
2. Set the environment variables, or pass them as command line arguments.
3. Run the following command. Aider will think our gateway is OpenAI, and we handle the routing behind the scenes!`,
      code: `# Set environment variables (Linux/macOS)
export OPENAI_API_BASE="${gatewayUrl}"
export OPENAI_API_KEY="${exampleKey}"
aider --model coding-agent

# PowerShell (Windows)
$env:OPENAI_API_BASE="${gatewayUrl}"
$env:OPENAI_API_KEY="${exampleKey}"
aider --model coding-agent`,
      language: 'bash'
    },
    {
      id: 'python',
      name: 'Python OpenAI SDK',
      icon: '🐍',
      description: 'Call the pool gateway inside your Python data science and agent scripts.',
      instructions: `Install the official OpenAI Python package (pip install openai).
Then run the code snippet below. It redirects the client base_url to our local gateway, automatically invoking priorities and failovers.`,
      code: `from openai import OpenAI

# Direct client to the local Free Pool Gateway
client = OpenAI(
    base_url="${gatewayUrl}",
    api_key="${exampleKey}"
)

print("Sending chat request to gateway...")
response = client.chat.completions.create(
    model="strong-reasoning", # invokes the deepseek-r1 / reasoning pool
    messages=[
        {"role": "user", "content": "Write a quicksort function in Python."}
    ],
    temperature=0.3,
    stream=False
)

print("\\nResponse:")
print(response.choices[0].message.content)
`,
      language: 'python'
    },
    {
      id: 'node',
      name: 'NodeJS OpenAI SDK',
      icon: '🟢',
      description: 'Integrate the local gateway pool in your JavaScript/TypeScript backend services.',
      instructions: `Install the openai npm library (npm install openai).
Import and initialize the client pointing to our port ${serverPort}.`,
      code: `import OpenAI from 'openai';

// Binds client to local gateway
const openai = new OpenAI({
  baseURL: '${gatewayUrl}',
  apiKey: '${exampleKey}'
});

async function main() {
  console.log('Requesting gateway pool...');
  const response = await openai.chat.completions.create({
    model: 'coding-agent', // routes to groq -> gemini -> openrouter
    messages: [
      { role: 'user', content: 'Create a regex to validate telephone numbers.' }
    ]
  });

  console.log('Response content:');
  console.log(response.choices[0].message.content);
}

main();
`,
      language: 'javascript'
    },
    {
      id: 'curl',
      name: 'Direct REST cURL',
      icon: '🌐',
      description: 'Make lightweight REST requests to the gateway from any command line environment.',
      instructions: `Send a standard application/json POST request to the local chat completions endpoint:`,
      code: `curl ${gatewayUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${exampleKey}" \\
  -d '{
    "model": "fast-flash",
    "messages": [
      {
        "role": "user",
        "content": "What is the speed of gravity?"
      }
    ],
    "temperature": 0.7
  }'`,
      language: 'bash'
    }
  ];

  const active = guides.find(g => g.id === activeGuide) || guides[0];

  const handleCopy = () => {
    if (!active.code) return;
    navigator.clipboard.writeText(active.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="animate-fade-in" style={{
      display: 'grid',
      gridTemplateColumns: '250px 1fr',
      gap: '1.5rem',
      height: 'calc(100vh - 220px)',
      minHeight: '450px'
    }}>
      {/* Side Tabs Navigation */}
      <div className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <h4 style={{ margin: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Integrations</h4>
        {guides.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => { setActiveGuide(g.id); setCopied(false); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              textAlign: 'left',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: '1px solid transparent',
              background: activeGuide === g.id ? 'var(--accent-glow)' : 'transparent',
              borderColor: activeGuide === g.id ? 'var(--accent)' : 'transparent',
              color: activeGuide === g.id ? 'var(--text)' : 'var(--text-muted)',
              width: '100%',
              fontSize: '0.9rem'
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>{g.icon}</span>
            <span>{g.name}</span>
          </button>
        ))}
      </div>

      {/* Guide Details Panel */}
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', overflowY: 'auto' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.4rem' }}>{active.name} Integration</h3>
          <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.9rem' }}>{active.description}</p>
        </div>

        {/* Instructions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <strong style={{ fontSize: '0.9rem' }}>Setup Steps:</strong>
          <div style={{
            background: 'oklch(15% 0.015 255.4 / 0.4)',
            padding: '1rem 1.25rem',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            fontSize: '0.9rem',
            whiteSpace: 'pre-wrap',
            lineHeight: '1.6'
          }}>
            {active.instructions}
          </div>
        </div>

        {/* Code Snippet Area */}
        {active.code && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.9rem' }}>Configuration Code Snippet:</strong>
              <button 
                type="button" 
                onClick={handleCopy}
                style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem' }}
              >
                {copied ? 'Copied! ✓' : 'Copy Snippet'}
              </button>
            </div>
            <pre style={{
              background: '#040406',
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              overflowX: 'auto',
              fontFamily: 'Consolas, Courier New, monospace',
              fontSize: '0.82rem',
              lineHeight: '1.5',
              margin: 0,
              color: '#c5c9db'
            }}>
              <code>{active.code}</code>
            </pre>
          </div>
        )}

      </div>
    </div>
  );
};
